import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const chapterId = process.argv[2];
if (!chapterId) throw new Error('Uso: node scripts/ocr-loose-angle.mjs <chapterId>');

const chapterPath = path.join('data', `${chapterId}.json`);
const ocrPath = path.join('data', `${chapterId}.ocr.json`);
const chapter = JSON.parse(await fs.readFile(chapterPath, 'utf8'));
const ocr = JSON.parse(await fs.readFile(ocrPath, 'utf8'));
const lang = ({ en:'eng', ja:'jpn', ko:'kor', zh:'chi_sim', 'zh-hk':'chi_tra', 'zh-ro':'chi_sim' })[chapter.sourceLanguage] || 'eng';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mb-loose-angle-'));

const letterCount = (s) => (String(s).match(/[\p{L}]/gu) || []).length;
const wordCount = (s) => (String(s).match(/[A-Za-z]{3,}/g) || []).length;
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n * 100) / 100));
const normalizeText = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

function isSfx(text) {
  const clean = String(text).trim().replace(/[.!?,:;…'"-]/g,' ');
  const words = clean.split(/\s+/).filter(Boolean);
  const n = letterCount(clean);
  return n >= 4 && n <= 30 && words.length <= 4 && words.every(w => /^[A-Z]{2,}$/.test(w));
}

function classify(text, angle) {
  if (isSfx(text)) return 'sfx';
  if (/\b(quest|reward|experience|level|skill|system|coin|received)\b/i.test(text)) return 'system';
  if (angle !== 0 || String(text).trim() === String(text).trim().toUpperCase()) return 'narration';
  return 'other';
}

function useful(text, confidence) {
  const letters = letterCount(text);
  const sfx = isSfx(text);
  if (letters < 4) return false;
  if (confidence < (sfx ? 47 : 60)) return false;
  if (lang === 'eng' && wordCount(text) < 1 && !/[A-Z]{4,}/.test(text)) return false;
  if (String(text).replace(/\s+/g,'').length <= 4 && confidence < 70) return false;
  return true;
}

function parseTsv(tsv) {
  const rows = tsv.split(/\r?\n/).filter(Boolean);
  let width=0,height=0;
  const groups=new Map();
  for (let i=1;i<rows.length;i++) {
    const c=rows[i].split('\t');
    if (c.length<12) continue;
    const level=+c[0], block=+c[2], par=+c[3], line=+c[4], word=+c[5];
    const left=+c[6], top=+c[7], w=+c[8], h=+c[9], conf=+c[10];
    const text=c.slice(11).join('\t').trim();
    if (level===1) { width=w; height=h; continue; }
    if (level!==5 || !text || !Number.isFinite(conf) || conf<25) continue;
    const key=`${block}:${par}:${line}`;
    if (!groups.has(key)) groups.set(key,{left,top,right:left+w,bottom:top+h,confSum:0,count:0,parts:[],block,par});
    const g=groups.get(key);
    g.left=Math.min(g.left,left); g.top=Math.min(g.top,top); g.right=Math.max(g.right,left+w); g.bottom=Math.max(g.bottom,top+h);
    g.confSum+=conf; g.count++; g.parts.push({word,text});
  }
  const lines=[...groups.values()].map(g=>({
    left:g.left,top:g.top,right:g.right,bottom:g.bottom,block:g.block,par:g.par,
    confidence:g.confSum/Math.max(1,g.count),
    text:g.parts.sort((a,b)=>a.word-b.word).map(p=>p.text).join(' ').trim(),
  })).filter(x=>useful(x.text,x.confidence)).sort((a,b)=>a.top-b.top||a.left-b.left);
  return {width,height,lines};
}

function horizontalOverlap(a,b) {
  const ov=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
  return ov/Math.max(1,Math.min(a.right-a.left,b.right-b.left));
}

function mergeLines(lines,pageW,pageH) {
  const groups=[];
  for (const line of lines) {
    let best=null;
    for (const g of groups) {
      const last=g.lines[g.lines.length-1];
      const lh=Math.max(1,last.bottom-last.top), ch=Math.max(1,line.bottom-line.top), maxH=Math.max(lh,ch);
      const gap=line.top-last.bottom;
      const centerA=(last.left+last.right)/2, centerB=(line.left+line.right)/2;
      const same=last.block===line.block&&last.par===line.par;
      if (gap < -maxH*0.25 || gap > Math.max(maxH*2,pageH*0.014)) continue;
      if (horizontalOverlap(last,line)<0.12 && Math.abs(centerA-centerB)>pageW*(same?0.20:0.14)) continue;
      if (Math.max(g.bottom,line.bottom)-Math.min(g.top,line.top)>pageH*0.16) continue;
      best=g; break;
    }
    if (!best) groups.push({left:line.left,top:line.top,right:line.right,bottom:line.bottom,lines:[line]});
    else {
      best.left=Math.min(best.left,line.left); best.top=Math.min(best.top,line.top); best.right=Math.max(best.right,line.right); best.bottom=Math.max(best.bottom,line.bottom); best.lines.push(line);
    }
  }
  return groups.map(g=>{
    const text=g.lines.map(x=>x.text).join('\n');
    const confidence=g.lines.reduce((s,x)=>s+x.confidence,0)/g.lines.length;
    return {...g,text,confidence};
  }).filter(g=>useful(g.text,g.confidence));
}

function inverseRotatePoint(x,y,angle,rotW,rotH,origW,origH) {
  const rad=angle*Math.PI/180, cos=Math.cos(rad), sin=Math.sin(rad);
  const dx=x-rotW/2, dy=y-rotH/2;
  return {
    x: origW/2 + cos*dx + sin*dy,
    y: origH/2 - sin*dx + cos*dy,
  };
}

function transformRect(rect,angle,rotW,rotH,origW,origH) {
  const pts=[
    inverseRotatePoint(rect.left,rect.top,angle,rotW,rotH,origW,origH),
    inverseRotatePoint(rect.right,rect.top,angle,rotW,rotH,origW,origH),
    inverseRotatePoint(rect.right,rect.bottom,angle,rotW,rotH,origW,origH),
    inverseRotatePoint(rect.left,rect.bottom,angle,rotW,rotH,origW,origH),
  ];
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  const left=Math.max(0,Math.min(...xs)), top=Math.max(0,Math.min(...ys));
  const right=Math.min(origW,Math.max(...xs)), bottom=Math.min(origH,Math.max(...ys));
  return {
    x:clamp(left/origW*100), y:clamp(top/origH*100),
    width:clamp((right-left)/origW*100), height:clamp((bottom-top)/origH*100),
  };
}

function overlapSmall(a,b) {
  const l=Math.max(a.x,b.x), t=Math.max(a.y,b.y), r=Math.min(a.x+a.width,b.x+b.width), bt=Math.min(a.y+a.height,b.y+b.height);
  if (r<=l||bt<=t) return 0;
  const inter=(r-l)*(bt-t), aa=a.width*a.height, bb=b.width*b.height;
  return inter/Math.max(0.01,Math.min(aa,bb));
}

function duplicate(existing,candidate) {
  const ct=normalizeText(candidate.sourceText);
  return existing.some(r=>{
    const ov=overlapSmall(r.bounds,candidate.bounds);
    if (ov>=0.55) return true;
    const rt=normalizeText(r.sourceText);
    if (ct.length>=6&&rt.length>=6&&(ct.includes(rt)||rt.includes(ct))&&ov>=0.12) return true;
    return false;
  });
}

const angles=[0,45,90,135,180,225,270,315];
let addedTotal=0;
const perAngle={};

for (const page of chapter.pages) {
  const target=ocr.pages.find(p=>p.page===page.page);
  if (!target) continue;
  const ext=path.extname(page.fileName||'')||'.png';
  const original=path.join(tmp,`p${page.page}${ext}`);
  const res=await fetch(page.imageUrl,{headers:{'User-Agent':'MangaBridge/1.0 loose-angle OCR'}});
  if (!res.ok) continue;
  await fs.writeFile(original,Buffer.from(await res.arrayBuffer()));
  const {stdout:origDim}=await exec('identify',['-format','%w %h',original]);
  const [origW,origH]=origDim.trim().split(/\s+/).map(Number);
  const enhanced=path.join(tmp,`p${page.page}-enh.png`);
  await exec('convert',[original,'-colorspace','Gray','-auto-level','-sharpen','0x1',enhanced]);

  const accepted=[...target.regions];
  let pageAdded=0;
  for (const angle of angles) {
    const input=angle===0?enhanced:path.join(tmp,`p${page.page}-r${angle}.png`);
    if (angle!==0) await exec('convert',[enhanced,'-background','white','-alpha','remove','-alpha','off','-rotate',String(angle),input]);
    const psm=angle===0?'12':'11';
    const {stdout}=await exec('tesseract',[input,'stdout','-l',lang,'--psm',psm,'tsv'],{maxBuffer:20*1024*1024});
    const parsed=parseTsv(stdout);
    for (const g of mergeLines(parsed.lines,parsed.width,parsed.height)) {
      const padX=Math.max(2,(g.right-g.left)*0.04), padY=Math.max(2,(g.bottom-g.top)*0.08);
      const rect={left:g.left-padX,top:g.top-padY,right:g.right+padX,bottom:g.bottom+padY};
      const bounds=transformRect(rect,angle,parsed.width,parsed.height,origW,origH);
      if (bounds.width<0.5||bounds.height<0.4) continue;
      if (bounds.width*bounds.height>1800) continue;
      const candidate={
        id:`p${page.page}-loose-${angle}-${pageAdded+1}`,
        type:classify(g.text,angle), sourceText:g.text, translatedText:'',
        confidence:Math.round(g.confidence*10)/10, orientationAngle:angle, detectionPass:angle===0?'sparse-loose':'rotated-loose', bounds,
      };
      if (duplicate(accepted,candidate)) continue;
      accepted.push(candidate); pageAdded++; addedTotal++; perAngle[angle]=(perAngle[angle]||0)+1;
    }
  }
  target.regions=accepted;
  if (pageAdded) console.log(`Página ${page.page}: +${pageAdded} textos soltos/angulados`);
}

ocr.schema='manga-bridge-ocr/v6';
ocr.looseAngleOcr={enabled:true,angles,addedRegions:addedTotal,addedByAngle:perAngle};
ocr.totalRegions=ocr.pages.reduce((s,p)=>s+p.regions.length,0);
if (ocr.filtering) ocr.filtering.mergedRegions=ocr.totalRegions;
await fs.writeFile(ocrPath,JSON.stringify(ocr,null,2)+'\n','utf8');
console.log(`OCR loose-angle concluído: +${addedTotal}; total ${ocr.totalRegions}`);
