import json
import re
import urllib.request
from pathlib import Path

from paddleocr import PaddleOCR
from PIL import Image

chapter_id = __import__('sys').argv[1]
chapter_path = Path('data') / f'{chapter_id}.json'
ocr_path = Path('data') / f'{chapter_id}.ocr.json'
chapter = json.loads(chapter_path.read_text(encoding='utf-8'))
base = json.loads(ocr_path.read_text(encoding='utf-8'))

lang_map = {
    'en': 'en',
    'ja': 'japan',
    'ko': 'korean',
    'zh': 'ch',
    'zh-hk': 'chinese_cht',
    'zh-ro': 'ch',
}
lang = lang_map.get(chapter.get('sourceLanguage'), 'en')

ocr = PaddleOCR(
    lang=lang,
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=True,
    engine='paddle',
)

tmp = Path('.paddle-ocr-work')
tmp.mkdir(exist_ok=True)


def letters(text):
    return len(re.findall(r'[^\W\d_]', str(text), flags=re.UNICODE))


def normalize(text):
    return re.sub(r'[^\w]+', ' ', str(text).lower(), flags=re.UNICODE).strip()


def is_watermark(text):
    t = normalize(text).replace(' ', '')
    markers = ('cloudmerge', 'acolam', 'cola', 'merger.com', 'merge.com')
    return any(m.replace(' ', '') in t for m in markers)


def is_sfx(text):
    clean = re.sub(r'[^A-Za-z ]+', ' ', str(text)).strip()
    words = [w for w in clean.split() if w]
    return (
        1 <= len(words) <= 4
        and 3 <= letters(clean) <= 34
        and all(w.upper() == w for w in words)
    )


def classify(text, bounds):
    if is_sfx(text):
        return 'sfx'
    if bounds['height'] > bounds['width'] * 1.7:
        return 'narration'
    return 'other'


def polygon_bounds(poly, width, height):
    xs = [float(p[0]) for p in poly]
    ys = [float(p[1]) for p in poly]
    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    pad_x = max(1.0, (right - left) * 0.025)
    pad_y = max(1.0, (bottom - top) * 0.06)
    left = max(0.0, left - pad_x)
    top = max(0.0, top - pad_y)
    right = min(float(width), right + pad_x)
    bottom = min(float(height), bottom + pad_y)
    return {
        'x': round(left / width * 100, 2),
        'y': round(top / height * 100, 2),
        'width': round((right - left) / width * 100, 2),
        'height': round((bottom - top) / height * 100, 2),
    }


def intersection(a, b):
    left = max(a['x'], b['x'])
    top = max(a['y'], b['y'])
    right = min(a['x'] + a['width'], b['x'] + b['width'])
    bottom = min(a['y'] + a['height'], b['y'] + b['height'])
    if right <= left or bottom <= top:
        return 0.0
    return (right - left) * (bottom - top)


def area(a):
    return max(0.001, a['width'] * a['height'])


def overlap_small(a, b):
    return intersection(a, b) / min(area(a), area(b))


def overlap_candidate(a, b):
    return intersection(a, b) / area(b)


def center_inside(inner, outer):
    cx = inner['x'] + inner['width'] / 2
    cy = inner['y'] + inner['height'] / 2
    return (
        outer['x'] <= cx <= outer['x'] + outer['width']
        and outer['y'] <= cy <= outer['y'] + outer['height']
    )


def score_region(region):
    conf = float(region.get('confidence') or 0)
    text = str(region.get('sourceText') or '')
    return conf + min(18, letters(text) * 0.20)


def read_page_result(image_path, page_number):
    result_path = tmp / f'page-{page_number}.paddle.json'
    results = list(ocr.predict(str(image_path)))
    if not results:
        return []
    results[0].save_to_json(save_path=str(result_path))
    payload = json.loads(result_path.read_text(encoding='utf-8'))
    res = payload.get('res', payload)
    rec_texts = res.get('rec_texts', [])
    rec_scores = res.get('rec_scores', [])
    rec_polys = res.get('rec_polys', [])
    rows = []
    with Image.open(image_path) as im:
        width, height = im.size
    for idx, text in enumerate(rec_texts):
        text = str(text or '').strip()
        confidence = float(rec_scores[idx]) if idx < len(rec_scores) else 0.0
        poly = rec_polys[idx] if idx < len(rec_polys) else None
        if not text or not poly:
            continue
        if confidence < 0.58 or letters(text) < 2 or is_watermark(text):
            continue
        bounds = polygon_bounds(poly, width, height)
        if bounds['width'] < 0.35 or bounds['height'] < 0.22:
            continue
        rows.append({
            'sourceText': text,
            'translatedText': '',
            'confidence': round(confidence * 100, 1),
            'type': classify(text, bounds),
            'bounds': bounds,
            'polygon': poly,
            'detectionEngine': 'paddleocr',
        })
    return rows


stats = {
    'recognizedCandidates': 0,
    'improvedExisting': 0,
    'addedRegions': 0,
    'skippedAsDuplicate': 0,
}

for chapter_page in chapter['pages']:
    page_no = int(chapter_page['page'])
    page_row = next((p for p in base['pages'] if int(p.get('page', -1)) == page_no), None)
    if page_row is None:
        page_row = {'page': page_no, 'regions': []}
        base['pages'].append(page_row)
    existing = page_row.setdefault('regions', [])

    suffix = Path(chapter_page.get('fileName') or 'page.png').suffix or '.png'
    image_path = tmp / f'page-{page_no}{suffix}'
    req = urllib.request.Request(
        chapter_page['imageUrl'],
        headers={'User-Agent': 'MangaBridge-PaddleOCR/1.0'},
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        image_path.write_bytes(response.read())

    try:
        candidates = read_page_result(image_path, page_no)
    except Exception as exc:
        print(f'PADDLE page={page_no} falhou: {exc}')
        continue

    stats['recognizedCandidates'] += len(candidates)
    assigned = {i: [] for i in range(len(existing))}
    unused = []

    for candidate in candidates:
        best_idx = None
        best_match = 0.0
        for idx, region in enumerate(existing):
            bounds = region.get('bounds') or {}
            if not all(k in bounds for k in ('x', 'y', 'width', 'height')):
                continue
            match = max(
                overlap_small(bounds, candidate['bounds']),
                overlap_candidate(bounds, candidate['bounds']),
                0.62 if center_inside(candidate['bounds'], bounds) else 0.0,
            )
            if match > best_match:
                best_match = match
                best_idx = idx
        if best_idx is not None and best_match >= 0.42:
            assigned[best_idx].append(candidate)
        else:
            unused.append(candidate)

    for idx, rows in assigned.items():
        if not rows:
            continue
        rows.sort(key=lambda r: (r['bounds']['y'], r['bounds']['x']))
        combined = '\n'.join(r['sourceText'] for r in rows)
        avg_conf = sum(r['confidence'] for r in rows) / len(rows)
        old = existing[idx]
        old_text = str(old.get('sourceText') or '')
        old_conf = float(old.get('confidence') or 0)
        old_letters = max(1, letters(old_text))
        new_letters = letters(combined)
        looks_better = (
            avg_conf >= 82
            and new_letters >= old_letters * 0.65
            and (avg_conf >= old_conf + 2 or new_letters >= old_letters * 1.15)
        )
        if looks_better:
            old['sourceText'] = combined
            old['confidence'] = round(avg_conf, 1)
            old['detectionEngine'] = 'paddleocr-correction'
            if all(r['type'] == 'sfx' for r in rows):
                old['type'] = 'sfx'
            stats['improvedExisting'] += 1

    for candidate in unused:
        duplicate = any(
            overlap_small((region.get('bounds') or {}), candidate['bounds']) >= 0.58
            for region in existing
            if all(k in (region.get('bounds') or {}) for k in ('x', 'y', 'width', 'height'))
        )
        if duplicate:
            stats['skippedAsDuplicate'] += 1
            continue
        candidate['id'] = f'p{page_no}-paddle{sum(1 for r in existing if str(r.get("id", "")).startswith(f"p{page_no}-paddle")) + 1}'
        existing.append(candidate)
        stats['addedRegions'] += 1

    print(
        f'PADDLE page={page_no}: candidatos={len(candidates)} '
        f'total_pagina={len(existing)}'
    )

base['schema'] = 'manga-bridge-ocr/v7'
base['paddleOcrLayer'] = {
    'enabled': True,
    'language': lang,
    **stats,
}
base['totalRegions'] = sum(len(p.get('regions', [])) for p in base['pages'])
if isinstance(base.get('filtering'), dict):
    base['filtering']['mergedRegions'] = base['totalRegions']

ocr_path.write_text(json.dumps(base, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('PADDLE_LAYER_OK', json.dumps(base['paddleOcrLayer']), 'total', base['totalRegions'])
