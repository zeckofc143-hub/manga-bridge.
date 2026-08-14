import json
import os
import urllib.request
from pathlib import Path

from paddleocr import TextDetection

CHAPTER_ID = "51429dea-7169-4913-b5d6-a4ee00329eb7"
TARGET_PAGES = {3, 4, 6, 7}
chapter = json.loads(Path(f"data/{CHAPTER_ID}.json").read_text(encoding="utf-8"))
out_dir = Path("paddle-probe")
out_dir.mkdir(exist_ok=True)

model = TextDetection(engine="paddle")
summary = {"chapterId": CHAPTER_ID, "pages": []}

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
    results = list(model.predict(str(image_path)))
    if not results:
        summary["pages"].append({"page": page_no, "boxes": 0, "error": "no result"})
        continue

    results[0].save_to_json(save_path=str(result_path))
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    res = payload.get("res", payload)
    polys = res.get("dt_polys", [])
    scores = res.get("dt_scores", [])
    summary["pages"].append({
        "page": page_no,
        "boxes": len(polys),
        "scores": scores,
        "polygons": polys,
    })
    print(f"PADDLE page={page_no} boxes={len(polys)}")

Path("paddle-probe-summary.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print("PADDLE_PROBE_OK", [(p["page"], p["boxes"]) for p in summary["pages"]])
