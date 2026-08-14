import fs from 'node:fs/promises';
import path from 'node:path';

const uuid = String(process.argv[2] || '').trim();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
  throw new Error('UUID de capítulo inválido.');
}

const API = 'https://api.mangadex.org';
const getJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MangaBridge-GitHub/1.0',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} em ${url}`);
  return response.json();
};

const chapterResult = await getJson(`${API}/chapter/${uuid}?includes[]=manga`);
const chapterData = chapterResult?.data;
if (!chapterData) throw new Error('Capítulo não encontrado no MangaDex.');

const attrs = chapterData.attributes || {};
const mangaRelation = (chapterData.relationships || []).find((r) => r.type === 'manga');
if (!mangaRelation?.id) throw new Error('Relação de mangá ausente.');

let mangaAttributes = mangaRelation.attributes;
if (!mangaAttributes) {
  const mangaResult = await getJson(`${API}/manga/${mangaRelation.id}`);
  mangaAttributes = mangaResult?.data?.attributes || {};
}

const atHome = await getJson(`${API}/at-home/server/${uuid}`);
const baseUrl = atHome?.baseUrl;
const hash = atHome?.chapter?.hash;
const files = atHome?.chapter?.data || [];
if (!baseUrl || !hash || !files.length) throw new Error('Nenhuma página retornada pelo at-home.');

const title = mangaAttributes?.title || {};
const alt = mangaAttributes?.altTitles || [];
const pickTitle = () => title['pt-br'] || title.en || title.ja || title['ja-ro'] || title.zh || title['zh-hk'] || Object.values(title)[0] || alt.flatMap((x) => Object.values(x || {}))[0] || 'Obra sem título';

const payload = {
  schema: 'manga-bridge-chapter/v2',
  cachedAt: new Date().toISOString(),
  source: 'MangaDex',
  chapterId: uuid,
  mangaId: mangaRelation.id,
  mangaTitle: pickTitle(),
  chapterNumber: attrs.chapter || null,
  chapterTitle: attrs.title || null,
  volume: attrs.volume || null,
  sourceLanguage: attrs.translatedLanguage || null,
  pages: files.map((fileName, index) => ({
    page: index + 1,
    fileName,
    imageUrl: `${baseUrl}/data/${hash}/${fileName}`,
  })),
};

await fs.mkdir('data', { recursive: true });
const out = path.join('data', `${uuid}.json`);
await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`CACHE_OK ${out} ${payload.pages.length} páginas`);
