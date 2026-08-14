import json
import re
import urllib.request
from difflib import SequenceMatcher
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


def alnum(text):
    return len(re.findall(r'[\w]', str(text), flags=re.UNICODE))


def normalize(text):
    return re.sub(r'[^\w]+', ' ', str(text).lower(), flags=re.UNICODE).strip()


def compact(text):
    return re.sub(r'[\W_]+', '', str(text).lower(), flags=re.UNICODE)


def is_watermark(text):
    raw = str(text or '').lower()
    joined = normalize(text).replace(' ', '')
    if not joined:
        return False

    # URLs/domains are never translation targets in the page artwork.
    if re.search(
        r'(?:https?://|www\.|[a-z0-9][a-z0-9.-]{1,}\.(?:com|net|org|io|co|me|cc|tv|site|xyz))',
        raw.replace(' ', ''),
        flags=re.I,
    ):
        return True

    # Known scan/mirror watermarks observed in the source pages.
    markers = (
        'coeam',
        'cloudmerge',
        'acloudmerge',
        'acolam',
        'manhuamerge',
        'manhuacom',
        'mangamerge',
        'acemanga',
    )
    return any(marker in joined for marker in markers)


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
    left = max(float(a.get('x', 0)), float(b.get('x', 0)))
    top = max(float(a.get('y', 0)), float(b.get('y', 0)))
    right = min(
        float(a.get('x', 0)) + float(a.get('width', 0)),
        float(b.get('x', 0)) + float(b.get('width', 0)),
    )
    bottom = min(
        float(a.get('y', 0)) + float(a.get('height', 0)),
        float(b.get('y', 0)) + float(b.get('height', 0)),
    )
    if right <= left or bottom <= top:
        return 0.0
    return (right - left) * (bottom - top)


def area(a):
    return max(0.001, float(a.get('width', 0)) * float(a.get('height', 0)))


def overlap_small(a, b):
    return intersection(a, b) / min(area(a), area(b))


def overlap_candidate(a, b):
    return intersection(a, b) / area(b)


def iou(a, b):
    inter = intersection(a, b)
    return inter / max(0.001, area(a) + area(b) - inter)


def center(bounds):
    return (
        float(bounds.get('x', 0)) + float(bounds.get('width', 0)) / 2,
        float(bounds.get('y', 0)) + float(bounds.get('height', 0)) / 2,
    )


def center_inside(inner, outer):
    cx, cy = center(inner)
    return (
        float(outer.get('x', 0)) <= cx <= float(outer.get('x', 0)) + float(outer.get('width', 0))
        and float(outer.get('y', 0)) <= cy <= float(outer.get('y', 0)) + float(outer.get('height', 0))
    )


def horizontal_overlap(a, b):
    left = max(float(a['x']), float(b['x']))
    right = min(float(a['x']) + float(a['width']), float(b['x']) + float(b['width']))
    if right <= left:
        return 0.0
    return (right - left) / max(0.001, min(float(a['width']), float(b['width'])))


def vertical_gap(a, b):
    a_top, a_bottom = float(a['y']), float(a['y']) + float(a['height'])
    b_top, b_bottom = float(b['y']), float(b['y']) + float(b['height'])
    if a_bottom < b_top:
        return b_top - a_bottom
    if b_bottom < a_top:
        return a_top - b_bottom
    return 0.0


def bounds_union(rows):
    bounds = [row['bounds'] for row in rows]
    left = min(float(b['x']) for b in bounds)
    top = min(float(b['y']) for b in bounds)
    right = max(float(b['x']) + float(b['width']) for b in bounds)
    bottom = max(float(b['y']) + float(b['height']) for b in bounds)
    return {
        'x': round(max(0.0, left), 2),
        'y': round(max(0.0, top), 2),
        'width': round(min(100.0, right) - max(0.0, left), 2),
        'height': round(min(100.0, bottom) - max(0.0, top), 2),
    }


def text_similarity(a, b):
    ca, cb = compact(a), compact(b)
    if not ca or not cb:
        return 0.0
    if min(len(ca), len(cb)) >= 3 and (ca in cb or cb in ca):
        return 1.0
    return SequenceMatcher(None, ca, cb).ratio()


def score_region(region):
    conf = float(region.get('confidence') or 0)
    text = str(region.get('sourceText') or '')
    engine = str(region.get('detectionEngine') or '')
    engine_bonus = 8 if engine == 'paddleocr' else 6 if engine == 'paddleocr-correction' else 0
    return conf + engine_bonus + min(18, letters(text) * 0.20)


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


def can_group_rows(a, b):
    ab, bb = a['bounds'], b['bounds']
    h1, h2 = float(ab['height']), float(bb['height'])
    height_ratio = min(h1, h2) / max(0.001, max(h1, h2))
    if height_ratio < 0.34:
        return False

    gap = vertical_gap(ab, bb)
    if gap > max(0.55, max(h1, h2) * 1.15):
        return False

    hover = horizontal_overlap(ab, bb)
    acx, _ = center(ab)
    bcx, _ = center(bb)
    center_x_distance = abs(acx - bcx)
    if hover < 0.32 and center_x_distance > max(float(ab['width']), float(bb['width'])) * 0.34:
        return False

    proposed = bounds_union([a, b])
    if proposed['height'] > 13.5:
        return False

    if proposed['width'] > 92 and gap > 0.15:
        return False

    return True


def group_paddle_rows(rows):
    groups = [[row] for row in sorted(rows, key=lambda r: (r['bounds']['y'], r['bounds']['x']))]
    changed = True
    guard = 0
    while changed and guard < 10:
        guard += 1
        changed = False
        used = [False] * len(groups)
        next_groups = []
        for i, group in enumerate(groups):
            if used[i]:
                continue
            merged = list(group)
            used[i] = True
            while True:
                proxy = {
                    'bounds': bounds_union(merged),
                    'sourceText': '\n'.join(r['sourceText'] for r in merged),
                }
                best_j = None
                best_gap = 999
                for j, other in enumerate(groups):
                    if used[j]:
                        continue
                    other_proxy = {
                        'bounds': bounds_union(other),
                        'sourceText': '\n'.join(r['sourceText'] for r in other),
                    }
                    if not can_group_rows(proxy, other_proxy):
                        continue
                    gap = vertical_gap(proxy['bounds'], other_proxy['bounds'])
                    if gap < best_gap:
                        best_gap = gap
                        best_j = j
                if best_j is None:
                    break
                merged.extend(groups[best_j])
                used[best_j] = True
                changed = True
            next_groups.append(merged)
        groups = next_groups

    logical = []
    for group in groups:
        group = sorted(group, key=lambda r: (r['bounds']['y'], r['bounds']['x']))
        text = '\n'.join(r['sourceText'] for r in group).strip()
        if is_watermark(text):
            continue
        conf = sum(float(r['confidence']) for r in group) / len(group)
        bounds = bounds_union(group)
        item = {
            'sourceText': text,
            'translatedText': '',
            'confidence': round(conf, 1),
            'type': classify(text, bounds),
            'bounds': bounds,
            'detectionEngine': 'paddleocr',
        }
        if len(group) == 1 and group[0].get('polygon') is not None:
            item['polygon'] = group[0]['polygon']
        else:
            item['polygons'] = [r.get('polygon') for r in group if r.get('polygon') is not None]
        logical.append(item)
    return logical


def should_tighten_bounds(old, candidate):
    old_bounds = old.get('bounds') or {}
    new_bounds = candidate.get('bounds') or {}
    if not all(k in old_bounds for k in ('x', 'y', 'width', 'height')):
        return True
    if not all(k in new_bounds for k in ('x', 'y', 'width', 'height')):
        return False

    similarity = text_similarity(old.get('sourceText', ''), candidate.get('sourceText', ''))
    ov = overlap_small(old_bounds, new_bounds)
    old_area = area(old_bounds)
    new_area = area(new_bounds)
    return (
        similarity >= 0.58
        or (ov >= 0.55 and new_area <= old_area * 0.92)
        or (ov >= 0.30 and old_area >= new_area * 1.7)
    )


def is_noise(region, matched_by_paddle=False):
    text = str(region.get('sourceText') or '').strip()
    if not text or is_watermark(text):
        return True

    conf = float(region.get('confidence') or 0)
    b = region.get('bounds') or {}
    if not all(k in b for k in ('x', 'y', 'width', 'height')):
        return True

    count_letters = letters(text)
    count_alnum = alnum(text)
    raw = re.sub(r'\s+', '', text)
    ratio = count_alnum / max(1, len(raw))
    engine = str(region.get('detectionEngine') or '')

    if count_letters < 2:
        return True
    if float(b['width']) < 0.32 or float(b['height']) < 0.18:
        return True

    short_visual_sfx = engine.startswith('paddleocr') and is_sfx(text) and conf >= 60
    if short_visual_sfx:
        return False

    if ratio < 0.45 and conf < 90:
        return True
    if count_letters <= 3 and conf < 82:
        return True
    if count_letters <= 5 and conf < 66:
        return True

    if not matched_by_paddle and not engine.startswith('paddleocr'):
        if conf < 58:
            return True
        if count_letters <= 6 and conf < 76:
            return True

    return False


def merge_text_regions(a, b):
    rows = [a, b]
    rows.sort(key=lambda r: (r['bounds']['y'], r['bounds']['x']))
    text_a = str(rows[0].get('sourceText') or '').strip()
    text_b = str(rows[1].get('sourceText') or '').strip()
    similarity = text_similarity(text_a, text_b)

    if similarity >= 0.82:
        preferred = max(rows, key=score_region)
        result = dict(preferred)
        if area(rows[0]['bounds']) != area(rows[1]['bounds']):
            tighter = min(rows, key=lambda r: area(r['bounds']))
            if str(tighter.get('detectionEngine') or '').startswith('paddleocr'):
                result['bounds'] = dict(tighter['bounds'])
                if tighter.get('polygon') is not None:
                    result['polygon'] = tighter['polygon']
        return result

    combined_text = f'{text_a}\n{text_b}'.strip()
    best = max(rows, key=score_region)
    result = dict(best)
    result['sourceText'] = combined_text
    result['bounds'] = bounds_union(rows)
    result['confidence'] = round(
        (float(rows[0].get('confidence') or 0) + float(rows[1].get('confidence') or 0)) / 2,
        1,
    )
    result['type'] = classify(combined_text, result['bounds'])
    result['detectionEngine'] = 'merged-ocr'
    return result


def dedupe_and_merge(regions):
    ordered = sorted(regions, key=score_region, reverse=True)
    kept = []
    removed = 0
    for region in ordered:
        merged_into = None
        for idx, existing in enumerate(kept):
            sim = text_similarity(region.get('sourceText', ''), existing.get('sourceText', ''))
            ov = overlap_small(region['bounds'], existing['bounds'])
            same_center_distance = sum(
                (a - b) ** 2 for a, b in zip(center(region['bounds']), center(existing['bounds']))
            ) ** 0.5

            duplicate = (
                (sim >= 0.70 and ov >= 0.24)
                or (sim >= 0.86 and same_center_distance <= 4.5)
                or (sim >= 0.92 and (center_inside(region['bounds'], existing['bounds']) or center_inside(existing['bounds'], region['bounds'])))
            )
            if duplicate:
                kept[idx] = merge_text_regions(existing, region)
                merged_into = idx
                removed += 1
                break
        if merged_into is None:
            kept.append(region)

    changed = True
    guard = 0
    while changed and guard < 8:
        guard += 1
        changed = False
        out = []
        used = [False] * len(kept)
        for i, a in enumerate(kept):
            if used[i]:
                continue
            current = a
            used[i] = True
            while True:
                best_j = None
                best_gap = 999
                for j, b in enumerate(kept):
                    if used[j]:
                        continue
                    ab, bb = current['bounds'], b['bounds']
                    gap = vertical_gap(ab, bb)
                    hover = horizontal_overlap(ab, bb)
                    hratio = min(float(ab['height']), float(bb['height'])) / max(0.001, max(float(ab['height']), float(bb['height'])))
                    proposed = bounds_union([current, b])

                    if gap > max(0.45, max(float(ab['height']), float(bb['height'])) * 0.85):
                        continue
                    if hover < 0.42:
                        continue
                    if hratio < 0.28:
                        continue
                    if proposed['height'] > 11.5 or proposed['width'] > 94:
                        continue

                    if current.get('type') == 'sfx' and b.get('type') == 'sfx' and gap > 0.20:
                        continue

                    if gap < best_gap:
                        best_gap = gap
                        best_j = j

                if best_j is None:
                    break
                current = merge_text_regions(current, kept[best_j])
                used[best_j] = True
                removed += 1
                changed = True
            out.append(current)
        kept = out

    kept.sort(key=lambda r: (r['bounds']['y'], r['bounds']['x']))
    return kept, removed


stats = {
    'recognizedCandidates': 0,
    'logicalPaddleRegions': 0,
    'improvedExisting': 0,
    'repositionedExisting': 0,
    'addedRegions': 0,
    'watermarksRemoved': 0,
    'noiseRemoved': 0,
    'deduplicatedOrMerged': 0,
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
        raw_candidates = read_page_result(image_path, page_no)
        candidates = group_paddle_rows(raw_candidates)
    except Exception as exc:
        print(f'PADDLE page={page_no} falhou: {exc}')
        continue

    stats['recognizedCandidates'] += len(raw_candidates)
    stats['logicalPaddleRegions'] += len(candidates)

    matched_existing = set()
    assigned = {i: [] for i in range(len(existing))}
    unused = []

    for candidate in candidates:
        best_idx = None
        best_match = 0.0
        for idx, region in enumerate(existing):
            bounds = region.get('bounds') or {}
            if not all(k in bounds for k in ('x', 'y', 'width', 'height')):
                continue
            sim = text_similarity(region.get('sourceText', ''), candidate.get('sourceText', ''))
            match = max(
                overlap_small(bounds, candidate['bounds']),
                overlap_candidate(bounds, candidate['bounds']),
                iou(bounds, candidate['bounds']) * 1.15,
                0.62 if center_inside(candidate['bounds'], bounds) else 0.0,
                0.58 if sim >= 0.78 and sum((a - b) ** 2 for a, b in zip(center(bounds), center(candidate['bounds']))) ** 0.5 <= 5.5 else 0.0,
            )
            if match > best_match:
                best_match = match
                best_idx = idx
        if best_idx is not None and best_match >= 0.34:
            assigned[best_idx].append(candidate)
            matched_existing.add(best_idx)
        else:
            unused.append(candidate)

    for idx, rows in assigned.items():
        if not rows:
            continue

        rows.sort(key=lambda r: (r['bounds']['y'], r['bounds']['x']))
        combined = '\n'.join(r['sourceText'] for r in rows).strip()
        avg_conf = sum(float(r['confidence']) for r in rows) / len(rows)
        union_bounds = bounds_union(rows)
        union_candidate = {
            'sourceText': combined,
            'confidence': avg_conf,
            'bounds': union_bounds,
            'type': classify(combined, union_bounds),
            'detectionEngine': 'paddleocr',
        }

        old = existing[idx]
        old_text = str(old.get('sourceText') or '')
        old_conf = float(old.get('confidence') or 0)
        old_letters = max(1, letters(old_text))
        new_letters = letters(combined)
        similarity = text_similarity(old_text, combined)

        looks_better = (
            avg_conf >= 78
            and new_letters >= old_letters * 0.55
            and (
                similarity >= 0.48
                or avg_conf >= old_conf + 2
                or new_letters >= old_letters * 1.12
            )
        )

        if looks_better:
            old['sourceText'] = combined
            old['confidence'] = round(avg_conf, 1)
            old['detectionEngine'] = 'paddleocr-correction'
            old['type'] = union_candidate['type']
            stats['improvedExisting'] += 1

        if avg_conf >= 72 and should_tighten_bounds(old, union_candidate):
            old['bounds'] = union_candidate['bounds']
            stats['repositionedExisting'] += 1

    for candidate in unused:
        duplicate = any(
            (
                overlap_small((region.get('bounds') or {}), candidate['bounds']) >= 0.50
                and text_similarity(region.get('sourceText', ''), candidate.get('sourceText', '')) >= 0.45
            )
            for region in existing
            if all(k in (region.get('bounds') or {}) for k in ('x', 'y', 'width', 'height'))
        )
        if duplicate:
            stats['deduplicatedOrMerged'] += 1
            continue

        candidate['id'] = f'p{page_no}-paddle{sum(1 for r in existing if str(r.get("id", "")).startswith(f"p{page_no}-paddle")) + 1}'
        existing.append(candidate)
        stats['addedRegions'] += 1

    cleaned = []
    for idx, region in enumerate(existing):
        text = str(region.get('sourceText') or '')
        if is_watermark(text):
            stats['watermarksRemoved'] += 1
            continue
        was_matched = idx in matched_existing or str(region.get('detectionEngine') or '').startswith('paddleocr')
        if is_noise(region, matched_by_paddle=was_matched):
            stats['noiseRemoved'] += 1
            continue
        cleaned.append(region)

    cleaned, merged_count = dedupe_and_merge(cleaned)
    stats['deduplicatedOrMerged'] += merged_count

    seen_ids = set()
    for n, region in enumerate(cleaned, start=1):
        rid = str(region.get('id') or '')
        if not rid or rid in seen_ids:
            rid = f'p{page_no}-r{n}'
            region['id'] = rid
        seen_ids.add(rid)

    page_row['regions'] = cleaned

    print(
        f'PADDLE page={page_no}: linhas={len(raw_candidates)} '
        f'logicas={len(candidates)} total_pagina={len(cleaned)}'
    )

base['schema'] = 'manga-bridge-ocr/v8'
base['engine'] = 'tesseract+paddleocr'
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
