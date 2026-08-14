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

function parseTsv(tsv, pageNumber) {
  const lines = tsv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  let pageWidth = 0;
  let pageHeight = 0;
  const groups = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split('\t');
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
    const key = `${block}:${par}`;

    if (!groups.has(key)) {
      groups.set(key, {
        left,
        top,
        right: left + width,
        bottom: top + height,
        confSum: 0,
        confCount: 0,
        lines: new Map(),
      });
    }

    const g = groups.get(key);
    g.left = Math.min(g.left, left);
    g.top = Math.min(g.top, top);
    g.right = Math.max(g.right, left + width);
    g.bottom = Math.max(g.bottom, top + height);
    g.confSum += conf;
    g.confCount += 1;
    if (!g.lines.has(line)) g.lines.set(line, []);
    g.lines.get(line).push({ word, text });
  }

  if (!pageWidth || !pageHeight) return [];

  const regions = [];
  for (const g of groups.values()) {
    const sourceText = [...g.lines.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, words]) => words.sort((a, b) => a.word - b.word).map((w) => w.text).join(' '))
      .filter(Boolean)
      .join('\n')
      .trim();

    if (!sourceText || sourceText.length < 2) continue;

    const padX = Math.max(2, (g.right - g.left) * 0.04);
    const padY = Math.max(2, (g.bottom - g.top) * 0.08);
    const left = Math.max(0, g.left - padX);
    const top = Math.max(0, g.top - padY);
    const right = Math.min(pageWidth, g.right + padX);
    const bottom = Math.min(pageHeight, g.bottom + padY);

    const bounds = {
      x: clamp(pct(left, pageWidth)),
      y: clamp(pct(top, pageHeight)),
      width: clamp(pct(right - left, pageWidth)),
      height: clamp(pct(bottom - top, pageHeight)),
    };

    if (bounds.width < 0.5 || bounds.height < 0.3) continue;

    regions.push({
      id: `p${pageNumber}-ocr${regions.length + 1}`,
      type: 'other',
      sourceText,
      translatedText: '',
      confidence: Math.round((g.confSum / Math.max(1, g.confCount)) * 10) / 10,
      bounds,
    });
  }

  return regions;
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mangabridge-ocr-'));
const pages = [];

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
    const regions = parseTsv(stdout, page.page);
    console.log(`${regions.length} regiões`);
    pages.push({ page: page.page, regions });
  } catch (error) {
    console.log(`falhou: ${error.message}`);
    pages.push({ page: page.page, regions: [], error: error.message });
  }
}

const totalRegions = pages.reduce((sum, p) => sum + p.regions.length, 0);
const output = {
  schema: 'manga-bridge-ocr/v1',
  chapterId,
  sourceLanguage: chapter.sourceLanguage || null,
  engine: 'tesseract',
  tesseractLanguage: lang,
  generatedAt: new Date().toISOString(),
  totalRegions,
  pages,
};

await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`OCR concluído: ${totalRegions} regiões em ${chapter.pages.length} páginas -> ${outputPath}`);
