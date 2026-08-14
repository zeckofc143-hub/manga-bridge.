import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const chapterId = process.argv[2];
if (!chapterId) throw new Error('Uso: node scripts/ocr-rotated.mjs <chapterId>');

const chapterPath = path.join('data', `${chapterId}.json`);
const ocrPath = path.join('data', `${chapterId}.ocr.json`);
const chapter = JSON.parse(await fs.readFile(chapterPath, 'utf8'));
const ocr = JSON.parse(await fs.readFile(ocrPath, 'utf8'));

const langMap = {
  en: 'eng',
  ja: 'jpn',
  ko: 'kor',
  zh: 'chi_sim',
  'zh-hk': 'chi_tra',
  'zh-ro': 'chi_sim',
};
const lang = langMap[chapter.sourceLanguage] || 'eng';

function letters(text) {
  return (String(text).match(/[\p{L}]/gu) || []).length;
}
function alnum(text) {
  return (String(text).match(/[\p{L}\p{N}]/gu) || []).length;
}
function words(text) {
  return (String(text).match(/[A-Za-z]{3,}/g) || []).length;
}
function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}
function normalizeText(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function classify(text, orientation) {
  const t = String(text).trim();
  if (/\b(quest|reward|experience|level|skill|system|coin|received)\b/i.test(t)) return 'system';
  const compactLetters = letters(t);
  const wc = words(t);
  const upperLetters = (t.match(/[A-Z]/g) || []).length;
  const allUpper = compactLetters > 0 && upperLetters / compactLetters > 0.82;
  if (allUpper && wc <= 3 && compactLetters <= 22) return 'sfx';
  if (orientation !== 'normal' || allUpper || wc >= 4) return 'narration';
  return 'dialogue';
}
function iou(a, b) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
function transformBounds(bounds, rotation) {
  const { x, y, width, height } = bounds;
  if (rotation === 90) {
    return {
      x: clamp(y),
      y: clamp(100 - (x + width)),
      width: clamp(height),
      height: clamp(width),
    };
  }
  return {
    x: clamp(100 - (y + height)),
    y: clamp(x),
    width: clamp(height),
    height: clamp(width),
  };
}

function parseTsv(tsv, pageNumber, rotation) {
  const rows = tsv.split(/\r?\n/).filter(Boolean);
  let pageWidth = 0;
  let pageHeight = 0;
  const groups = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const cols = rows[i].split('\t');
    if (cols.length < 12) continue;
    const [levelS, , blockS, parS, lineS, wordS, leftS, topS, widthS, heightS, confS, ...textParts] = cols;
    const level = Number(levelS);
    const left = Number(leftS);
    const top = Number(topS);
    const width = Number(widthS);
    const height = Number(heightS);
    const conf = Number(confS);
    const text = textParts.join('\t').trim();

    if (level === 1) {
      pageWidth = width;
      pageHeight = height;
      continue;
    }
    if (level !== 5 || !text || !Number.isFinite(conf) || conf < 45) continue;

    const key = `${blockS}:${parS}:${lineS}`;
    if (!groups.has(key)) {
      groups.set(key, { left, top, right: left + width, bottom: top + height, confSum: 0, count: 0, parts: [] });
    }
    const g = groups.get(key);
    g.left = Math.min(g.left, left);
    g.top = Math.min(g.top, top);
    g.right = Math.max(g.right, left + width);
    g.bottom = Math.max(g.bottom, top + height);
    g.confSum += conf;
    g.count += 1;
    g.parts.push({ word: Number(wordS), text });
  }

  if (!pageWidth || !pageHeight) return [];

  const lines = [...groups.values()].map((g) => ({
    left: g.left,
    top: g.top,
    right: g.right,
    bottom: g.bottom,
    confidence: g.confSum / Math.max(1, g.count),
    text: g.parts.sort((a, b) => a.word - b.word).map((p) => p.text).join(' ').trim(),
  })).filter((line) => {
    const text = line.text;
    if (line.confidence < 58) return false;
    if (letters(text) < 4 || alnum(text) < 4) return false;
    if (lang === 'eng' && words(text) < 1 && !/[A-Z]{5,}/.test(text)) return false;
    return true;
  }).sort((a, b) => a.top - b.top || a.left - b.left);

  const clusters = [];
  for (const line of lines) {
    let best = null;
    for (const c of clusters) {
      const last = c.lines[c.lines.length - 1];
      const lineH = Math.max(1, line.bottom - line.top);
      const lastH = Math.max(1, last.bottom - last.top);
      const gap = line.top - last.bottom;
      const overlap = Math.max(0, Math.min(last.right, line.right) - Math.max(last.left, line.left));
      const minW = Math.max(1, Math.min(last.right - last.left, line.right - line.left));
      const overlapRatio = overlap / minW;
      const centerA = (last.left + last.right) / 2;
      const centerB = (line.left + line.right) / 2;
      if (gap < -Math.max(lineH, lastH) * 0.25) continue;
      if (gap > Math.max(lineH, lastH) * 2.2) continue;
      if (overlapRatio < 0.12 && Math.abs(centerA - centerB) > pageWidth * 0.18) continue;
      best = c;
      break;
    }
    if (!best) {
      clusters.push({ lines: [line] });
    } else {
      best.lines.push(line);
    }
  }

  const out = [];
  for (const c of clusters) {
    const text = c.lines.map((line) => line.text).join('\n').trim();
    const confidence = c.lines.reduce((s, line) => s + line.confidence, 0) / c.lines.length;
    if (confidence < 64 || letters(text) < 5) continue;
    const left = Math.min(...c.lines.map((l) => l.left));
    const top = Math.min(...c.lines.map((l) => l.top));
    const right = Math.max(...c.lines.map((l) => l.right));
    const bottom = Math.max(...c.lines.map((l) => l.bottom));
    const rotatedBounds = {
      x: (left / pageWidth) * 100,
      y: (top / pageHeight) * 100,
      width: ((right - left) / pageWidth) * 100,
      height: ((bottom - top) / pageHeight) * 100,
    };
    const bounds = transformBounds(rotatedBounds, rotation);
    if (bounds.width < 0.6 || bounds.height < 0.6) continue;
    if (bounds.width > 55 && bounds.height > 35) continue;
    out.push({
      id: `p${pageNumber}-rot${rotation}-${out.length + 1}`,
      type: classify(text, `rotated-${rotation}`),
      sourceText: text,
      translatedText: '',
      confidence: Math.round(confidence * 10) / 10,
      orientation: rotation === 90 ? 'rotated-90' : 'rotated-270',
      bounds,
    });
  }
  return out;
}

function dedupe(existing, candidates) {
  const result = [...existing];
  for (const candidate of candidates) {
    const candidateText = normalizeText(candidate.sourceText);
    const duplicate = result.some((region) => {
      const overlap = iou(region.bounds, candidate.bounds);
      if (overlap >= 0.35) return true;
      const existingText = normalizeText(region.sourceText);
      if (candidateText.length >= 6 && existingText.length >= 6 && (candidateText.includes(existingText) || existingText.includes(candidateText))) {
        return overlap >= 0.08;
      }
      return false;
    });
    if (!duplicate) result.push(candidate);
  }
  return result.map((region, index) => ({ ...region, id: region.id || `ocr-${index + 1}` }));
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mangabridge-rotated-'));
let added = 0;

for (const page of chapter.pages) {
  const target = ocr.pages.find((p) => p.page === page.page);
  if (!target) continue;
  const ext = path.extname(page.fileName || '') || '.png';
  const originalPath = path.join(tmpDir, `page-${page.page}${ext}`);
  const response = await fetch(page.imageUrl, { headers: { 'User-Agent': 'MangaBridge/1.0 (GitHub Actions rotated OCR)' } });
  if (!response.ok) continue;
  await fs.writeFile(originalPath, Buffer.from(await response.arrayBuffer()));

  const candidates = [];
  for (const rotation of [90, 270]) {
    const rotatedPath = path.join(tmpDir, `page-${page.page}-r${rotation}.png`);
    await execFileAsync('convert', [originalPath, '-rotate', String(rotation), rotatedPath], { maxBuffer: 10 * 1024 * 1024 });
    const { stdout } = await execFileAsync('tesseract', [rotatedPath, 'stdout', '-l', lang, '--psm', '11', 'tsv'], { maxBuffer: 20 * 1024 * 1024 });
    candidates.push(...parseTsv(stdout, page.page, rotation));
  }

  const before = target.regions.length;
  target.regions = dedupe(target.regions, candidates);
  const delta = target.regions.length - before;
  added += delta;
  if (delta > 0) console.log(`Página ${page.page}: +${delta} regiões rotacionadas`);
}

ocr.schema = 'manga-bridge-ocr/v5';
ocr.rotatedOcr = { enabled: true, angles: [90, 270], addedRegions: added };
ocr.totalRegions = ocr.pages.reduce((sum, p) => sum + p.regions.length, 0);
if (ocr.filtering) ocr.filtering.mergedRegions = ocr.totalRegions;
await fs.writeFile(ocrPath, JSON.stringify(ocr, null, 2) + '\n', 'utf8');
console.log(`OCR rotacionado concluído: +${added} regiões; total ${ocr.totalRegions}`);
