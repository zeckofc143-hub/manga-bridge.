import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

chapter_id = sys.argv[1]
mode = sys.argv[2] if len(sys.argv) > 2 else 'post'
ocr_path = Path('data') / f'{chapter_id}.ocr.json'
data = json.loads(ocr_path.read_text(encoding='utf-8'))


def compact(text):
    return re.sub(r'[\W_]+', '', str(text or '').lower(), flags=re.UNICODE)


def latin_tokens(text):
    return {w.lower() for w in re.findall(r'[A-Za-z]{2,}', str(text or ''))}


def is_watermark_fragment(text):
    raw = str(text or '').strip().lower()
    c = compact(raw)
    if not c:
        return False

    no_space = re.sub(r'\s+', '', raw)
    if re.search(r'(?:https?://|www\.|[a-z0-9][a-z0-9.-]{1,}\.(?:com|net|org|io|co|me|cc|tv|site|xyz))', no_space):
        return True

    exact_fragments = {
        'cola', 'colam', 'acloud', 'coeam', 'acoeam', 'mergercom',
        'cloudmerge', 'cloudmergecom', 'acolam', 'acolamcom',
    }
    if c in exact_fragments:
        return True

    brand_markers = (
        'cloudmerge', 'acloudmerge', 'colamanhua', 'coeammanhua',
        'manhuacom', 'manhuamerge', 'mangamerge', 'mergercom',
        'acemanga', 'acolam',
    )
    if any(marker in c for marker in brand_markers):
        return True

    # OCR often cuts COEAM/COLA/ACloud watermarks into 4–7 letter fragments.
    if len(c) <= 7 and (c.startswith('cola') or c.startswith('coeam') or c.startswith('acloud')):
        return True

    return False


def line_similarity(a, b):
    ca, cb = compact(a), compact(b)
    if not ca or not cb:
        return 0.0
    if min(len(ca), len(cb)) >= 4 and (ca in cb or cb in ca):
        return 1.0
    return SequenceMatcher(None, ca, cb).ratio()


def clean_text(text):
    source_lines = [line.strip() for line in str(text or '').splitlines() if line.strip()]
    kept = []
    removed_wm = 0
    removed_dupe = 0

    for line in source_lines:
        if is_watermark_fragment(line):
            removed_wm += 1
            continue

        if any(line_similarity(line, old) >= 0.90 for old in kept):
            removed_dupe += 1
            continue

        tokens = latin_tokens(line)
        if len(tokens) >= 4 and kept:
            previous_tokens = set().union(*(latin_tokens(old) for old in kept))
            coverage = len(tokens & previous_tokens) / max(1, len(tokens))
            if coverage >= 0.84:
                removed_dupe += 1
                continue

        kept.append(line)

    return '\n'.join(kept).strip(), removed_wm, removed_dupe


def area(b):
    return max(0.001, float(b.get('width', 0)) * float(b.get('height', 0)))


def intersection(a, b):
    left = max(float(a.get('x', 0)), float(b.get('x', 0)))
    top = max(float(a.get('y', 0)), float(b.get('y', 0)))
    right = min(float(a.get('x', 0)) + float(a.get('width', 0)), float(b.get('x', 0)) + float(b.get('width', 0)))
    bottom = min(float(a.get('y', 0)) + float(a.get('height', 0)), float(b.get('y', 0)) + float(b.get('height', 0)))
    if right <= left or bottom <= top:
        return 0.0
    return (right - left) * (bottom - top)


def overlap_small(a, b):
    return intersection(a, b) / min(area(a), area(b))


def center(b):
    return (
        float(b.get('x', 0)) + float(b.get('width', 0)) / 2,
        float(b.get('y', 0)) + float(b.get('height', 0)) / 2,
    )


def region_score(region):
    conf = float(region.get('confidence') or 0)
    engine = str(region.get('detectionEngine') or '')
    engine_bonus = 8 if engine.startswith('paddleocr') else 2 if engine == 'merged-ocr' else 0
    chars = len(compact(region.get('sourceText', '')))
    return conf + engine_bonus + min(12, chars * 0.08)


stats = {
    'mode': mode,
    'watermarkLinesRemoved': 0,
    'duplicateTextLinesRemoved': 0,
    'emptyRegionsRemoved': 0,
    'duplicateRegionsRemoved': 0,
}

for page in data.get('pages', []):
    cleaned = []
    for region in page.get('regions', []):
        new_text, wm_count, dupe_count = clean_text(region.get('sourceText', ''))
        stats['watermarkLinesRemoved'] += wm_count
        stats['duplicateTextLinesRemoved'] += dupe_count

        if not new_text:
            stats['emptyRegionsRemoved'] += 1
            continue

        region['sourceText'] = new_text
        cleaned.append(region)

    if mode == 'post':
        # Final same-place duplicate pass after both OCR engines have run.
        ordered = sorted(cleaned, key=region_score, reverse=True)
        kept = []
        for region in ordered:
            rb = region.get('bounds') or {}
            duplicate = False
            for existing in kept:
                eb = existing.get('bounds') or {}
                sim = line_similarity(region.get('sourceText', ''), existing.get('sourceText', ''))
                if sim < 0.84:
                    continue
                cx1, cy1 = center(rb)
                cx2, cy2 = center(eb)
                distance = ((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2) ** 0.5
                if overlap_small(rb, eb) >= 0.24 or distance <= 4.5:
                    duplicate = True
                    stats['duplicateRegionsRemoved'] += 1
                    break
            if not duplicate:
                kept.append(region)
        cleaned = sorted(kept, key=lambda r: ((r.get('bounds') or {}).get('y', 0), (r.get('bounds') or {}).get('x', 0)))

    page['regions'] = cleaned

data['totalRegions'] = sum(len(page.get('regions', [])) for page in data.get('pages', []))
if isinstance(data.get('filtering'), dict):
    data['filtering']['mergedRegions'] = data['totalRegions']

history = data.setdefault('cleanupHistory', [])
history.append(stats)
ocr_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('OCR_CLEANUP_OK', json.dumps(stats), 'total', data['totalRegions'])
