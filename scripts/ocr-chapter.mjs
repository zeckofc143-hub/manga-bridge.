import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const chapterId = process.argv[2];
if (!chapterId) throw new Error('Uso: node scripts/ocr-chapter.mjs <chapterId>');

const chapterPath = path.join('data', `${chapterId}.json`);
const outputPath = path.join('data', `${chapterId}.ocr.json`);
const chapter = JSON.parse(await fs.readFile(chapterPath, 'utf8'));

const langMap = {
  en: 'eng',
  ja: 'jpn',
  ko: 'kor',
  zh: 'chi_sim',
  'zh-hk': 'chi_tra',
  'zh-ro': 'chi_sim',
};
const lang = langMap[chapter.sourceLanguage] || 'eng';

function pct(n, total) {
  if (!Number.isFinite(n) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((n / total) * 10000) / 100;
}

function clamp(v) {
  return Math.max(0, Math.min(100, Math.round(v * 100) / 100));
}

function alphaNumericCount(text) {
  return (String(text).match(/[\p{L}\p{N}]/gu) || []).length;
}

function letterCount(text) {
  return (String(text).match(/[\p{L}]/gu) || []).length;
}

function isUsefulLine(line) {
  const text = line.text.trim();
  const compact = text.replace(/\s+/g, '');
  const alnum = alphaNumericCount(compact);
  const letters = letterCount(compact);
  const ratio = compact.length ? alnum / compact.length : 0;

  if (!text || alnum < 2) return false;
  if (ratio < 0.45) return false;
  if (line.confidence < 42) return false;

  // Tesseract costuma inventar muitos fragmentos de 2–3 letras na arte.
  // Só mantemos esses fragmentos quando a confiança é realmente alta.
  if (letters <= 2 && compact.length <= 3 && line.confidence < 82) return false;
  if (compact.length <= 4 && line.confidence < 62) return false;

  return true;
}

function horizontalOverlap(a, b) {
  const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const smaller = Math.max(1, Math.min(a.right - a.left, b.right - b.left));
  return overlap / smaller;
}

function canMerge(a, b, pageWidth, pageHeight) {
  const gap = b.top - a.bottom;
  const maxHeight = Math.max(1, a.bottom - a.top, b.bottom - b.top);
  const centerA = (a.left + a.right) / 2;
  const centerB = (b.left + b.right) / 2;
  const centerDistance = Math.abs(centerA - centerB);

  if (gap < -maxHeight * 0.35) return false;
  if (gap > Math.max(maxHeight * 2.2, pageHeight * 0.018)) return false;

  const overlap = horizontalOverlap(a, b);
  const centered = centerDistance <= pageWidth * 0.10;
  return overlap >= 0.28 || centered;
}

function mergeLines(lines, pageWidth, pageHeight) {
  const sorted = [...lines].sort((a, b) => a.top - b.top || a.left - b.left);
  const clusters = [];

  for (const line of sorted) {
    let best = null;
    let bestDistance = Infinity;

    for (const cluster of clusters) {
      if (!canMerge(cluster, line, pageWidth, pageHeight)) continue;
      const distance = Math.max(0, line.top - cluster.bottom);
      if (distance < bestDistance) {
        best = cluster;
        bestDistance = distance;
      }
    }

    if (!best) {
      clusters.push({
        left: line.left,
        top: line.top,
        right: line.right,
        bottom: line.bottom,
        confidenceSum: line.confidence,
        confidenceCount: 1,
        lines: [line],
      });
      continue;
    }

    best.left = Math.min(best.left, line.left);
    best.top = Math.min(best.top, line.top);
    best.right = Math.max(best.right, line.right);
    best.bottom = Math.max(best.bottom, line.bottom);
    best.confidenceSum += line.confidence;
    best.confidenceCount += 1;
    best.lines.push(line);
  }

  return clusters;
}

function parseTsv(tsv, pageNumber) {
  const rows = tsv.split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return { regions: [], rawLineCount: 0, keptLineCount: 0 };

  let pageWidth = 0;
  let pageHeight = 0;
  const lineGroups = new Map();

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

    if (level !== 5 || !text || !Number.isFinite(conf) || conf < 20) continue;

    const block = Number(blockS);
    const par = Number(parS);
    const line = Number(lineS);
    const word = Number(wordS);
    const key = `${block}:${par}:${line}`;

    if (!lineGroups.has(key)) {
      lineGroups.set(key, {
        left,
        top,
        right: left + width,
        bottom: top + height,
        confSum: 0,
        confCount: 0,
        words: [],
      });
    }

    const g = lineGroups.get(key);
    g.left = Math.min(g.left, left);
    g.top = Math.min(g.top, top);
    g.right = Math.max(g.right, left + width);
    g.bottom = Math.max(g.bottom, top + height);
    g.confSum += conf;
    g.confCount += 1;
    g.words.push({ word, text });
  }

  if (!pageWidth || !pageHeight) return { regions: [], rawLineCount: 0, keptLineCount: 0 };

  const rawLines = [...lineGroups.values()].map((g) => ({
    left: g.left,
    top: g.top,
    right: g.right,
    bottom: g.bottom,
    confidence: g.confSum / Math.max(1, g.confCount),
    text: g.words.sort((a, b) => a.word - b.word).map((w) => w.text).join(' ').trim(),
  }));

  const usefulLines = rawLines.filter(isUsefulLine);
  const clusters = mergeLines(usefulLines, pageWidth, pageHeight);
  const regions = [];

  for (const cluster of clusters) {
    cluster.lines.sort((a, b) => a.top - b.top || a.left - b.left);
    const sourceText = cluster.lines.map((line) => line.text).filter(Boolean).join('\n').trim();
    const confidence = cluster.confidenceSum / Math.max(1, cluster.confidenceCount);

    if (!sourceText || alphaNumericCount(sourceText) < 3) continue;
    if (sourceText.replace(/\s+/g, '').length <= 4 && confidence < 70) continue;

    const padX = Math.max(2, (cluster.right - cluster.left) * 0.05);
    const padY = Math.max(2, (cluster.bottom - cluster.top) * 0.10);
    const left = Math.max(0, cluster.left - padX);
    const top = Math.max(0, cluster.top - padY);
    const right = Math.min(pageWidth, cluster.right + padX);
    const bottom = Math.min(pageHeight, cluster.bottom + padY);

    const bounds = {
      x: clamp(pct(left, pageWidth)),
      y: clamp(pct(top, pageHeight)),
      width: clamp(pct(right - left, pageWidth)),
      height: clamp(pct(bottom - top, pageHeight)),
    };

    if (bounds.width < 0.7 || bounds.height < 0.35) continue;

    regions.push({
      id: `p${pageNumber}-ocr${regions.length + 1}`,
      type: 'other',
      sourceText,
      translatedText: '',
      confidence: Math.round(confidence * 10) / 10,
      bounds,
    });
  }

  return {
    regions,
    rawLineCount: rawLines.length,
    keptLineCount: usefulLines.length,
  };
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mangabridge-ocr-'));
const pages = [];
let rawLinesTotal = 0;
let keptLinesTotal = 0;

for (const page of chapter.pages) {
  const ext = path.extname(page.fileName || '') || '.img';
  const imagePath = path.join(tmpDir, `page-${page.page}${ext}`);
  process.stdout.write(`OCR página ${page.page}/${chapter.pages.length}... `);

  const response = await fetch(page.imageUrl, {
    headers: { 'User-Agent': 'MangaBridge/1.0 (GitHub Actions OCR)' },
  });
  if (!response.ok) {
    console.log(`falhou download HTTP ${response.status}`);
    pages.push({ page: page.page, regions: [], error: `HTTP ${response.status}` });
    continue;
  }
  await fs.writeFile(imagePath, Buffer.from(await response.arrayBuffer()));

  try {
    const { stdout } = await execFileAsync('tesseract', [imagePath, 'stdout', '-l', lang, '--psm', '11', 'tsv'], {
      maxBuffer: 20 * 1024 * 1024,
    });
    const parsed = parseTsv(stdout, page.page);
    rawLinesTotal += parsed.rawLineCount;
    keptLinesTotal += parsed.keptLineCount;
    console.log(`${parsed.regions.length} regiões limpas (${parsed.keptLineCount}/${parsed.rawLineCount} linhas mantidas)`);
    pages.push({ page: page.page, regions: parsed.regions });
  } catch (error) {
    console.log(`falhou: ${error.message}`);
    pages.push({ page: page.page, regions: [], error: error.message });
  }
}

const totalRegions = pages.reduce((sum, p) => sum + p.regions.length, 0);
const output = {
  schema: 'manga-bridge-ocr/v2',
  chapterId,
  sourceLanguage: chapter.sourceLanguage || null,
  engine: 'tesseract',
  tesseractLanguage: lang,
  generatedAt: new Date().toISOString(),
  filtering: {
    rawLines: rawLinesTotal,
    keptLines: keptLinesTotal,
    mergedRegions: totalRegions,
  },
  totalRegions,
  pages,
};

await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`OCR limpo concluído: ${totalRegions} regiões em ${chapter.pages.length} páginas -> ${outputPath}`);
