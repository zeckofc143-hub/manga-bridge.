import json
import urllib.request
from pathlib import Path

from paddleocr import PaddleOCR

CHAPTER_ID = "51429dea-7169-4913-b5d6-a4ee00329eb7"
TARGET_PAGES = {3, 4, 6, 7}
chapter = json.loads(Path(f"data/{CHAPTER_ID}.json").read_text(encoding="utf-8"))
out_dir = Path("paddle-probe")
out_dir.mkdir(exist_ok=True)

ocr = PaddleOCR(
    lang="en",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=True,
    engine="paddle",
)
summary = {"chapterId": CHAPTER_ID, "mode": "PP-OCRv6 full OCR", "pages": []}

for page in chapter["pages"]:
    page_no = int(page["page"])
    if page_no not in TARGET_PAGES:
        continue

    suffix = Path(page.get("fileName") or "page.png").suffix or ".png"
    image_path = out_dir / f"page-{page_no}{suffix}"
    req = urllib.request.Request(
        page["imageUrl"],
        headers={"User-Agent": "MangaBridge-Paddle-Probe/1.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        image_path.write_bytes(response.read())

    result_path = out_dir / f"page-{page_no}.json"
    results = list(ocr.predict(str(image_path)))
    if not results:
        summary["pages"].append({"page": page_no, "detected": 0, "recognized": 0, "error": "no result"})
        continue

    results[0].save_to_json(save_path=str(result_path))
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    res = payload.get("res", payload)
    dt_polys = res.get("dt_polys", [])
    rec_polys = res.get("rec_polys", [])
    rec_texts = res.get("rec_texts", [])
    rec_scores = res.get("rec_scores", [])
    orientation = res.get("textline_orientation_angles", [])

    rows = []
    for index, text in enumerate(rec_texts):
        rows.append({
            "text": text,
            "score": rec_scores[index] if index < len(rec_scores) else None,
            "polygon": rec_polys[index] if index < len(rec_polys) else None,
            "orientation": orientation[index] if index < len(orientation) else None,
        })

    summary["pages"].append({
        "page": page_no,
        "detected": len(dt_polys),
        "recognized": len(rec_texts),
        "rows": rows,
    })
    print(f"PADDLE_OCR page={page_no} detected={len(dt_polys)} recognized={len(rec_texts)}")
    for row in rows:
        print("  ", round(float(row["score"] or 0), 3), repr(row["text"]))

Path("paddle-probe-summary.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print("PADDLE_OCR_PROBE_OK", [(p["page"], p.get("detected"), p.get("recognized")) for p in summary["pages"]])
