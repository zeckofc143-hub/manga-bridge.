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

function boxWidth(box) {
  return Math.max(1, box.right - box.left);
}

function boxHeight(box) {
  return Math.max(1, box.bottom - box.top);
}

function horizontalOverlap(a, b) {
  const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  return overlap / Math.max(1, Math.min(boxWidth(a), boxWidth(b)));
}

function verticalOverlap(a, b) {
  const overlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return overlap / Math.max(1, Math.min(boxHeight(a), boxHeight(b)));
}

function horizontalGap(a, b) {
  if (a.right < b.left) return b.left - a.right;
  if (b.right < a.left) return a.left - b.right;
  return 0;
}

function heightSimilarity(a, b) {
  return Math.min(boxHeight(a), boxHeight(b)) / Math.max(boxHeight(a), boxHeight(b));
}

function isUsefulLine(line) {
  const text = line.text.trim();
  const compact = text.replace(/\s+/g, '');
  const alnum = alphaNumericCount(compact);
  const letters = letterCount(compact);
  const ratio = compact.length ? alnum / compact.length : 0;

  if (!text || alnum < 2) return false;
  if (ratio < 0.48) return false;
  if (line.confidence < 38) return false;

  // Fragmentos minúsculos na arte são a maior fonte de falso positivo.
  if (letters <= 2 && compact.length <= 3 && line.confidence < 88) return false;
  if (compact.length <= 4 && line.confidence < 58) return false;

  return true;
}

function canJoinSameRow(a, b, pageWidth) {
  const similarity = heightSimilarity(a, b);
  if (similarity < 0.42) return false;

  const overlapY = verticalOverlap(a, b);
  const centerYA = (a.top + a.bottom) / 2;
  const centerYB = (b.top + b.bottom) / 2;
  const centerYDistance = Math.abs(centerYA - centerYB);
  const maxHeight = Math.max(boxHeight(a), boxHeight(b));

  if (overlapY < 0.30 && centerYDistance > maxHeight * 0.72) return false;

  const gapX = horizontalGap(a, b);
  const maxGap = Math.max(pageWidth * 0.055, maxHeight * 5.5);
  return gapX <= maxGap;
}

function mergeTwoSameRow(a, b) {
  const ordered = a.left <= b.left ? [a, b] : [b, a];
  const totalWeight = (a.weight || 1) + (b.weight || 1);

  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
    confidence: ((a.confidence * (a.weight || 1)) + (b.confidence * (b.weight || 1))) / totalWeight,
    weight: totalWeight,
    text: `${ordered[0].text} ${ordered[1].text}`.replace(/\s+/g, ' ').trim(),
    block: a.block === b.block ? a.block : null,
    par: a.block === b.block && a.par === b.par ? a.par : null,
  };
}

function mergeSameRowFragments(lines, pageWidth) {
  let current = [...lines].sort((a, b) => a.top - b.top || a.left - b.left);
  let changed = true;
  let guard = 0;

  while (changed && guard < 8) {
    changed = false;
    guard += 1;
    const used = new Set();
    const next = [];

    for (let i = 0; i < current.length; i += 1) {
      if (used.has(i)) continue;
      let merged = current[i];
      used.add(i);

      while (true) {
        let bestIndex = -1;
        let bestGap = Infinity;
        for (let j = 0; j < current.length; j += 1) {
          if (used.has(j)) continue;
          const candidate = current[j];
          if (!canJoinSameRow(merged, candidate, pageWidth)) continue;
          const gap = horizontalGap(merged, candidate);
          if (gap < bestGap) {
            bestGap = gap;
            bestIndex = j;
          }
        }
        if (bestIndex < 0) break;
        merged = mergeTwoSameRow(merged, current[bestIndex]);
        used.add(bestIndex);
        changed = true;
      }

      next.push(merged);
    }

    current = next.sort((a, b) => a.top - b.top || a.left - b.left);
  }

  return current;
}

function canMergeVertical(cluster, line, pageWidth, pageHeight) {
  const last = cluster.lines[cluster.lines.length - 1];
  const lastHeight = boxHeight(last);
  const lineHeight = boxHeight(line);
  const maxHeight = Math.max(lastHeight, lineHeight);
  const gap = line.top - last.bottom;

  // Só olhamos para a linha imediatamente anterior do bloco. Isso impede
  // uma caixa grande de ir "pescando" texto distante pelo resto da página.
  if (gap < -maxHeight * 0.28) return false;
  if (gap > Math.max(maxHeight * 1.9, pageHeight * 0.013)) return false;
  if (heightSimilarity(last, line) < 0.38) return false;

  const overlap = horizontalOverlap(last, line);
  const centerLast = (last.left + last.right) / 2;
  const centerLine = (line.left + line.right) / 2;
  const centerDistance = Math.abs(centerLast - centerLine);
  const sameTesseractGroup = last.block != null && last.block === line.block && last.par != null && last.par === line.par;

  if (overlap < 0.12 && centerDistance > pageWidth * (sameTesseractGroup ? 0.22 : 0.15)) return false;

  const proposedTop = Math.min(cluster.top, line.top);
  const proposedBottom = Math.max(cluster.bottom, line.bottom);
  const proposedHeight = proposedBottom - proposedTop;
  const maxClusterHeight = pageHeight * (sameTesseractGroup ? 0.24 : 0.18);
  if (proposedHeight > maxClusterHeight) return false;

  return true;
}

function mergeVerticalLines(lines, pageWidth, pageHeight) {
  const sorted = [...lines].sort((a, b) => a.top - b.top || a.left - b.left);
  const clusters = [];

  for (const line of sorted) {
    let best = null;
    let bestDistance = Infinity;

    for (const cluster of clusters) {
      if (!canMergeVertical(cluster, line, pageWidth, pageHeight)) continue;
      const last = cluster.lines[cluster.lines.length - 1];
      const distance = Math.max(0, line.top - last.bottom);
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
        confidenceSum: line.confidence * (line.weight || 1),
        confidenceWeight: line.weight || 1,
        lines: [line],
      });
      continue;
    }

    best.left = Math.min(best.left, line.left);
    best.top = Math.min(best.top, line.top);
    best.right = Math.max(best.right, line.right);
    best.bottom = Math.max(best.bottom, line.bottom);
    best.confidenceSum += line.confidence * (line.weight || 1);
    best.confidenceWeight += line.weight || 1;
    best.lines.push(line);
  }

  return clusters;
}

function parseTsv(tsv, pageNumber) {
  const rows = tsv.split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return { regions: [], rawLineCount: 0, keptLineCount: 0, joinedLineCount: 0 };

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
        block,
        par,
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

  if (!pageWidth || !pageHeight) return { regions: [], rawLineCount: 0, keptLineCount: 0, joinedLineCount: 0 };

  const rawLines = [...lineGroups.values()].map((g) => ({
    left: g.left,
    top: g.top,
    right: g.right,
    bottom: g.bottom,
    confidence: g.confSum / Math.max(1, g.confCount),
    weight: 1,
    block: g.block,
    par: g.par,
    text: g.words.sort((a, b) => a.word - b.word).map((w) => w.text).join(' ').trim(),
  }));

  const prefiltered = rawLines.filter((line) => {
    const compact = line.text.replace(/\s+/g, '');
    return alphaNumericCount(compact) >= 2 && line.confidence >= 28;
  });
  const joinedLines = mergeSameRowFragments(prefiltered, pageWidth);
  const usefulLines = joinedLines.filter(isUsefulLine);
  const clusters = mergeVerticalLines(usefulLines, pageWidth, pageHeight);
  const regions = [];

  for (const cluster of clusters) {
    cluster.lines.sort((a, b) => a.top - b.top || a.left - b.left);
    const sourceText = cluster.lines.map((line) => line.text).filter(Boolean).join('\n').trim();
    const confidence = cluster.confidenceSum / Math.max(1, cluster.confidenceWeight);
    const letters = letterCount(sourceText);
    const regionHeightRatio = (cluster.bottom - cluster.top) / pageHeight;
    const regionWidthRatio = (cluster.right - cluster.left) / pageWidth;

    if (!sourceText || alphaNumericCount(sourceText) < 3) continue;
    if (sourceText.replace(/\s+/g, '').length <= 4 && confidence < 70) continue;

    // Uma frase curtíssima ocupando uma área enorme é quase sempre arte/logo
    // interpretado como texto. Evita casos como o falso positivo da capa.
    if (regionHeightRatio > 0.16 && letters < 35) continue;
    if (regionHeightRatio > 0.28) continue;
    if (regionWidthRatio > 0.94 && regionHeightRatio > 0.14) continue;

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
    joinedLineCount: joinedLines.length,
  };
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mangabridge-ocr-'));
const pages = [];
let rawLinesTotal = 0;
let joinedLinesTotal = 0;
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
    joinedLinesTotal += parsed.joinedLineCount;
    keptLinesTotal += parsed.keptLineCount;
    console.log(`${parsed.regions.length} regiões (${parsed.rawLineCount} brutas -> ${parsed.joinedLineCount} linhas unidas -> ${parsed.keptLineCount} úteis)`);
    pages.push({ page: page.page, regions: parsed.regions });
  } catch (error) {
    console.log(`falhou: ${error.message}`);
    pages.push({ page: page.page, regions: [], error: error.message });
  }
}

const totalRegions = pages.reduce((sum, p) => sum + p.regions.length, 0);
const output = {
  schema: 'manga-bridge-ocr/v3',
  chapterId,
  sourceLanguage: chapter.sourceLanguage || null,
  engine: 'tesseract',
  tesseractLanguage: lang,
  generatedAt: new Date().toISOString(),
  filtering: {
    rawLines: rawLinesTotal,
    joinedLines: joinedLinesTotal,
    keptLines: keptLinesTotal,
    mergedRegions: totalRegions,
  },
  totalRegions,
  pages,
};

await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`OCR v3 concluído: ${totalRegions} regiões em ${chapter.pages.length} páginas -> ${outputPath}`);
