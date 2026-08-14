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

function englishWordCount(text) {
  return (String(text).match(/[A-Za-z]{3,}/g) || []).length;
}

function hasLongUpperToken(text) {
  return (String(text).match(/\b[A-Z]{5,}\b/g) || []).length > 0;
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

  if (letters <= 2 && compact.length <= 3 && line.confidence < 88) return false;
  if (compact.length <= 4 && line.confidence < 58) return false;

  return true;
}

function canJoinSameRow(a, b, pageWidth) {
  if (heightSimilarity(a, b) < 0.42) return false;

  const overlapY = verticalOverlap(a, b);
  const centerYA = (a.top + a.bottom) / 2;
  const centerYB = (b.top + b.bottom) / 2;
  const centerYDistance = Math.abs(centerYA - centerYB);
  const maxHeight = Math.max(boxHeight(a), boxHeight(b));

  if (overlapY < 0.30 && centerYDistance > maxHeight * 0.72) return false;

  const gapX = horizontalGap(a, b);
  return gapX <= Math.max(pageWidth * 0.055, maxHeight * 5.5);
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
  const maxHeight = Math.max(boxHeight(last), boxHeight(line));
  const gap = line.top - last.bottom;

  if (gap < -maxHeight * 0.28) return false;
  if (gap > Math.max(maxHeight * 1.75, pageHeight * 0.012)) return false;
  if (heightSimilarity(last, line) < 0.40) return false;

  const overlap = horizontalOverlap(last, line);
  const centerLast = (last.left + last.right) / 2;
  const centerLine = (line.left + line.right) / 2;
  const centerDistance = Math.abs(centerLast - centerLine);
  const sameGroup = last.block != null && last.block === line.block && last.par != null && last.par === line.par;

  if (overlap < 0.14 && centerDistance > pageWidth * (sameGroup ? 0.20 : 0.13)) return false;

  const proposedTop = Math.min(cluster.top, line.top);
  const proposedBottom = Math.max(cluster.bottom, line.bottom);
  const maxClusterHeight = pageHeight * (sameGroup ? 0.20 : 0.15);
  if ((proposedBottom - proposedTop) > maxClusterHeight) return false;

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
        lines: [line],
      });
      continue;
    }

    best.left = Math.min(best.left, line.left);
    best.top = Math.min(best.top, line.top);
    best.right = Math.max(best.right, line.right);
    best.bottom = Math.max(best.bottom, line.bottom);
    best.lines.push(line);
  }

  return clusters;
}

function recomputeCluster(lines) {
  const kept = [...lines].sort((a, b) => a.top - b.top || a.left - b.left);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let confSum = 0;
  let confWeight = 0;

  for (const line of kept) {
    left = Math.min(left, line.left);
    top = Math.min(top, line.top);
    right = Math.max(right, line.right);
    bottom = Math.max(bottom, line.bottom);
    const weight = line.weight || 1;
    confSum += line.confidence * weight;
    confWeight += weight;
  }

  return {
    lines: kept,
    left,
    top,
    right,
    bottom,
    confidence: confSum / Math.max(1, confWeight),
  };
}

function pruneClusterLines(cluster) {
  let lines = [...cluster.lines].sort((a, b) => a.top - b.top || a.left - b.left);
  if (lines.length <= 1) return lines;

  const maxConfidence = Math.max(...lines.map((line) => line.confidence));

  lines = lines.filter((line) => {
    const letters = letterCount(line.text);
    if (line.confidence >= 55) return true;
    if (line.confidence >= 47 && letters >= 14) return true;
    if (line.confidence >= maxConfidence - 8 && letters >= 10) return true;
    return false;
  });

  if (!lines.length) return [];

  while (lines.length > 1) {
    const first = lines[0];
    const letters = letterCount(first.text);
    if (letters < 10 && first.confidence < Math.max(68, maxConfidence - 10)) {
      lines.shift();
    } else {
      break;
    }
  }

  while (lines.length > 1) {
    const last = lines[lines.length - 1];
    const letters = letterCount(last.text);
    if (letters < 10 && last.confidence < Math.max(68, maxConfidence - 10)) {
      lines.pop();
    } else {
      break;
    }
  }

  return lines;
}

function regionLooksUseful(region) {
  const sourceText = region.lines.map((line) => line.text).filter(Boolean).join('\n').trim();
  const compact = sourceText.replace(/\s+/g, '');
  const letters = letterCount(sourceText);

  if (!sourceText || alphaNumericCount(sourceText) < 3) return false;
  if (compact.length <= 4 && region.confidence < 70) return false;

  if (lang === 'eng' && region.confidence < 60) {
    const words = englishWordCount(sourceText);
    if (words < 2 && !hasLongUpperToken(sourceText)) return false;
  }

  if (region.confidence < 52 && letters < 28) return false;
  return true;
}

function parseTsv(tsv, pageNumber) {
  const rows = tsv.split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) {
    return { regions: [], rawLineCount: 0, joinedLineCount: 0, keptLineCount: 0, prunedLineCount: 0 };
  }

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

    const group = lineGroups.get(key);
    group.left = Math.min(group.left, left);
    group.top = Math.min(group.top, top);
    group.right = Math.max(group.right, left + width);
    group.bottom = Math.max(group.bottom, top + height);
    group.confSum += conf;
    group.confCount += 1;
    group.words.push({ word, text });
  }

  if (!pageWidth || !pageHeight) {
    return { regions: [], rawLineCount: 0, joinedLineCount: 0, keptLineCount: 0, prunedLineCount: 0 };
  }

  const rawLines = [...lineGroups.values()].map((group) => ({
    left: group.left,
    top: group.top,
    right: group.right,
    bottom: group.bottom,
    confidence: group.confSum / Math.max(1, group.confCount),
    weight: 1,
    block: group.block,
    par: group.par,
    text: group.words.sort((a, b) => a.word - b.word).map((word) => word.text).join(' ').trim(),
  }));

  const prefiltered = rawLines.filter((line) => {
    const compact = line.text.replace(/\s+/g, '');
    return alphaNumericCount(compact) >= 2 && line.confidence >= 28;
  });

  const joinedLines = mergeSameRowFragments(prefiltered, pageWidth);
  const usefulLines = joinedLines.filter(isUsefulLine);
  const clusters = mergeVerticalLines(usefulLines, pageWidth, pageHeight);
  const regions = [];
  let prunedLineCount = 0;

  for (const cluster of clusters) {
    const prunedLines = pruneClusterLines(cluster);
    prunedLineCount += Math.max(0, cluster.lines.length - prunedLines.length);
    if (!prunedLines.length) continue;

    const clean = recomputeCluster(prunedLines);
    if (!regionLooksUseful(clean)) continue;

    const sourceText = clean.lines.map((line) => line.text).filter(Boolean).join('\n').trim();
    const letters = letterCount(sourceText);
    const regionHeightRatio = (clean.bottom - clean.top) / pageHeight;
    const regionWidthRatio = (clean.right - clean.left) / pageWidth;

    if (regionHeightRatio > 0.14 && letters < 35) continue;
    if (regionHeightRatio > 0.22) continue;
    if (regionWidthRatio > 0.94 && regionHeightRatio > 0.12) continue;

    const padX = Math.max(2, (clean.right - clean.left) * 0.03);
    const padY = Math.max(2, (clean.bottom - clean.top) * 0.06);
    const left = Math.max(0, clean.left - padX);
    const top = Math.max(0, clean.top - padY);
    const right = Math.min(pageWidth, clean.right + padX);
    const bottom = Math.min(pageHeight, clean.bottom + padY);

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
      confidence: Math.round(clean.confidence * 10) / 10,
      bounds,
    });
  }

  return {
    regions,
    rawLineCount: rawLines.length,
    joinedLineCount: joinedLines.length,
    keptLineCount: usefulLines.length,
    prunedLineCount,
  };
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mangabridge-ocr-'));
const pages = [];
let rawLinesTotal = 0;
let joinedLinesTotal = 0;
let keptLinesTotal = 0;
let prunedLinesTotal = 0;

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
    const { stdout } = await execFileAsync(
      'tesseract',
      [imagePath, 'stdout', '-l', lang, '--psm', '11', 'tsv'],
      { maxBuffer: 20 * 1024 * 1024 },
    );

    const parsed = parseTsv(stdout, page.page);
    rawLinesTotal += parsed.rawLineCount;
    joinedLinesTotal += parsed.joinedLineCount;
    keptLinesTotal += parsed.keptLineCount;
    prunedLinesTotal += parsed.prunedLineCount;

    console.log(
      `${parsed.regions.length} regiões (${parsed.rawLineCount} brutas -> ${parsed.joinedLineCount} unidas -> ${parsed.keptLineCount} úteis; ${parsed.prunedLineCount} bordas removidas)`,
    );
    pages.push({ page: page.page, regions: parsed.regions });
  } catch (error) {
    console.log(`falhou: ${error.message}`);
    pages.push({ page: page.page, regions: [], error: error.message });
  }
}

const totalRegions = pages.reduce((sum, page) => sum + page.regions.length, 0);
const output = {
  schema: 'manga-bridge-ocr/v4',
  chapterId,
  sourceLanguage: chapter.sourceLanguage || null,
  engine: 'tesseract',
  tesseractLanguage: lang,
  generatedAt: new Date().toISOString(),
  filtering: {
    rawLines: rawLinesTotal,
    joinedLines: joinedLinesTotal,
    keptLines: keptLinesTotal,
    prunedEdgeLines: prunedLinesTotal,
    mergedRegions: totalRegions,
  },
  totalRegions,
  pages,
};

await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`OCR v4 concluído: ${totalRegions} regiões em ${chapter.pages.length} páginas -> ${outputPath}`);
