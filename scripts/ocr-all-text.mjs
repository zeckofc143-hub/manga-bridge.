import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const chapterId = process.argv[2];
if (!chapterId) throw new Error('Uso: node scripts/ocr-all-text.mjs <chapterId>');

const chapter = JSON.parse(await fs.readFile(path.join('data', `${chapterId}.json`), 'utf8'));
const outPath = path.join('data', `${chapterId}.ocr.json`);
const lang = ({ en:'eng', ja:'jpn', ko:'kor', zh:'chi_sim', 'zh-hk':'chi_tra', 'zh-ro':'chi_sim' })[chapter.sourceLanguage] || 'eng';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mb-ocr-all-'));

const letters = (s) => (String(s).match(/[\p{L}]/gu) || []).length;
const alnum = (s) => (String(s).match(/[\p{L}\p{N}]/gu) || []).length;
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n * 100) / 100));
const pct = (n, total) => clamp((n / total) * 100);

function isSfx(text) {
  const words = String(text).trim().replace(/[.!?,:;…'"-]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 4 && letters(text) <= 30 && words.every(w => /^[A-Z]{2,}$/.test(w));
}

function useful(text, confidence) {
  const compact = String(text).replace(/\s+/g, '');
  const a = alnum(compact);
  const ratio = compact.length ? a / compact.length : 0;
  const sfx = isSfx(text);
  if (a < 2 || ratio < (sfx ? 0.34 : 0.48)) return false;
  if (confidence < (sfx ? 30 : 38)) return false;
  if (compact.length <= 3 && confidence < (sfx ? 42 : 72)) return false;
  return true;
}

function parseLines(tsv) {
  const rows = tsv.split(/\r?\n/).filter(Boolean);
  let width = 0, height = 0;
  const groups = new Map();
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].split('\t');
    if (c.length < 12) continue;
    const level = +c[0], block = +c[2], par = +c[3], line = +c[4], word = +c[5];
    const left = +c[6], top = +c[7], w = +c[8], h = +c[9], conf = +c[10];
    const text = c.slice(11).join('\t').trim();
    if (level === 1) { width = w; height = h; continue; }
    if (level !== 5 || !text || !Number.isFinite(conf) || conf < 15) continue;
    const key = `${block}:${par}:${line}`;
    if (!groups.has(key)) groups.set(key, { left, top, right:left+w, bottom:top+h, confSum:0, count:0, words:[], block, par });
    const g = groups.get(key);
    g.left = Math.min(g.left,left); g.top = Math.min(g.top,top); g.right = Math.max(g.right,left+w); g.bottom = Math.max(g.bottom,top+h);
    g.confSum += conf; g.count++; g.words.push({ word, text });
  }
  const lines = [...groups.values()].map(g => ({
    left:g.left, top:g.top, right:g.right, bottom:g.bottom,
    confidence:g.confSum/Math.max(1,g.count), block:g.block, par:g.par,
    text:g.words.sort((a,b)=>a.word-b.word).map(x=>x.text).join(' ').trim(),
  })).filter(x => useful(x.text, x.confidence));
  return { width, height, lines };
}

function hOverlap(a,b) {
  const ov = Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left));
  return ov / Math.max(1, Math.min(a.right-a.left,b.right-b.left));
}

function mergeNearbyLines(lines, pageW, pageH) {
  const sorted = [...lines].sort((a,b)=>a.top-b.top || a.left-b.left);
  const groups = [];
  for (const line of sorted) {
    let best = null, bestGap = Infinity;
    for (const g of groups) {
      const last = g.lines[g.lines.length-1];
      const lh = Math.max(1,last.bottom-last.top), ch = Math.max(1,line.bottom-line.top);
      const gap = line.top-last.bottom;
      const centerDist = Math.abs((last.left+last.right-line.left-line.right)/2);
      const sameTess = last.block===line.block && last.par===line.par;
      const close = gap >= -Math.max(lh,ch)*0.3 && gap <= Math.max(Math.max(lh,ch)*1.8,pageH*0.012);
      const aligned = hOverlap(last,line) >= 0.12 || centerDist <= pageW*(sameTess?0.20:0.13);
      if (close && aligned && gap < bestGap && (Math.max(g.bottom,line.bottom)-Math.min(g.top,line.top)) <= pageH*0.18) {
        best = g; bestGap = gap;
      }
    }
    if (!best) groups.push({ left:line.left, top:line.top, right:line.right, bottom:line.bottom, lines:[line] });
    else {
      best.left=Math.min(best.left,line.left); best.top=Math.min(best.top,line.top); best.right=Math.max(best.right,line.right); best.bottom=Math.max(best.bottom,line.bottom); best.lines.push(line);
    }
  }
  return groups.map(g => {
    const text = g.lines.map(x=>x.text).join('\n');
    const confidence = g.lines.reduce((s,x)=>s+x.confidence,0)/g.lines.length;
    return { ...g, text, confidence };
  }).filter(g => useful(g.text,g.confidence));
}

function toOriginal(r, rot, W, H) {
  if (rot===90) return { left:r.top, top:H-r.right, right:r.bottom, bottom:H-r.left };
  if (rot===180) return { left:W-r.right, top:H-r.bottom, right:W-r.left, bottom:H-r.top };
  if (rot===270) return { left:W-r.bottom, top:r.left, right:W-r.top, bottom:r.right };
  return r;
}

function boundsFromRect(r,W,H) {
  const left=Math.max(0,Math.min(W,r.left)), top=Math.max(0,Math.min(H,r.top));
  const right=Math.max(left,Math.min(W,r.right)), bottom=Math.max(top,Math.min(H,r.bottom));
  return { x:pct(left,W), y:pct(top,H), width:pct(right-left,W), height:pct(bottom-top,H) };
}

function overlapSmall(a,b) {
  const l=Math.max(a.x,b.x), t=Math.max(a.y,b.y), r=Math.min(a.x+a.width,b.x+b.width), bt=Math.min(a.y+a.height,b.y+b.height);
  if (r<=l || bt<=t) return 0;
  const inter=(r-l)*(bt-t), aa=a.width*a.height, bb=b.width*b.height;
  return inter/Math.max(0.01,Math.min(aa,bb));
}

function score(r) {
  const words=(r.sourceText.match(/[A-Za-z]{3,}/g)||[]).length;
  return r.confidence + Math.min(18,words*2.2) + Math.min(12,letters(r.sourceText)*0.2) + (r.type==='sfx'?5:0);
}

function dedupe(regions,pageNo) {
  const kept=[];
  for (const r of [...regions].sort((a,b)=>score(b)-score(a))) {
    const idx=kept.findIndex(k=>overlapSmall(r.bounds,k.bounds)>=0.64);
    if (idx<0) kept.push(r);
    else if (score(r)>score(kept[idx])+3) kept[idx]=r;
  }
  return kept.sort((a,b)=>a.bounds.y-b.bounds.y || a.bounds.x-b.bounds.x).map((r,i)=>({...r,id:`p${pageNo}-ocr${i+1}`}));
}

async function makePasses(src,pageNo) {
  const enhanced=path.join(tmp,`p${pageNo}-enh.png`);
  await exec('convert',[src,'-colorspace','Gray','-auto-level','-sharpen','0x1',enhanced]);
  const specs=[
    { image:src, rot:0, psm:11, name:'base0' },
    { image:enhanced, rot:0, psm:11, name:'enh0' },
    { image:enhanced, rot:0, psm:12, name:'sparse0' },
  ];
  for (const rot of [90,180,270]) {
    const file=path.join(tmp,`p${pageNo}-r${rot}.png`);
    await exec('convert',[enhanced,'-rotate',String(rot),file]);
    specs.push({ image:file, rot, psm:11, name:`rot${rot}` });
  }
  return specs;
}

const pages=[];
let candidateTotal=0;
for (const page of chapter.pages) {
  process.stdout.write(`OCR ALL página ${page.page}/${chapter.pages.length}... `);
  const ext=path.extname(page.fileName||'')||'.img';
  const src=path.join(tmp,`p${page.page}${ext}`);
  const res=await fetch(page.imageUrl,{headers:{'User-Agent':'MangaBridge/1.0 GitHub OCR'}});
  if (!res.ok) { pages.push({page:page.page,regions:[],error:`HTTP ${res.status}`}); console.log('download falhou'); continue; }
  await fs.writeFile(src,Buffer.from(await res.arrayBuffer()));
  try {
    const {stdout:dim}=await exec('identify',['-format','%w %h',src]);
    const [W,H]=dim.trim().split(/\s+/).map(Number);
    const candidates=[];
    for (const pass of await makePasses(src,page.page)) {
      const {stdout}=await exec('tesseract',[pass.image,'stdout','-l',lang,'--psm',String(pass.psm),'tsv'],{maxBuffer:24*1024*1024});
      const parsed=parseLines(stdout);
      for (const g of mergeNearbyLines(parsed.lines,parsed.width,parsed.height)) {
        const sfx=isSfx(g.text);
        const padX=Math.max(2,(g.right-g.left)*(sfx?0.05:0.03));
        const padY=Math.max(2,(g.bottom-g.top)*(sfx?0.10:0.06));
        const rr={left:g.left-padX,top:g.top-padY,right:g.right+padX,bottom:g.bottom+padY};
        const bounds=boundsFromRect(toOriginal(rr,pass.rot,W,H),W,H);
        if (bounds.width<0.4 || bounds.height<0.25) continue;
        candidates.push({
          id:'candidate', type:sfx?'sfx':'other', sourceText:g.text, translatedText:'',
          confidence:Math.round(g.confidence*10)/10, rotation:pass.rot, detectionPass:pass.name, bounds,
        });
      }
    }
    candidateTotal+=candidates.length;
    const regions=dedupe(candidates,page.page);
    pages.push({page:page.page,regions});
    console.log(`${regions.length} finais / ${candidates.length} candidatas`);
  } catch (e) {
    pages.push({page:page.page,regions:[],error:e.message}); console.log(`falhou: ${e.message}`);
  }
}

const totalRegions=pages.reduce((s,p)=>s+p.regions.length,0);
const output={
  schema:'manga-bridge-ocr/v5', chapterId, sourceLanguage:chapter.sourceLanguage||null,
  engine:'tesseract-multipass-all-text', tesseractLanguage:lang, generatedAt:new Date().toISOString(),
  strategy:{passesPerPage:6,rotations:[0,90,180,270],psmModes:[11,12],enhancedGrayscale:true,focus:'all text: dialogue, narration, loose text, rotated text, signs and SFX'},
  filtering:{candidateRegionsBeforeDedupe:candidateTotal,finalRegions:totalRegions}, totalRegions, pages,
};
await fs.writeFile(outPath,JSON.stringify(output,null,2)+'\n','utf8');
console.log(`OCR ALL v5 concluído: ${totalRegions} regiões -> ${outPath}`);
