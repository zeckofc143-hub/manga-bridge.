const API = 'https://api.mangadex.org';

const els = {
  input: document.querySelector('#chapterInput'),
  load: document.querySelector('#loadBtn'),
  status: document.querySelector('#status'),
  chapterCard: document.querySelector('#chapterCard'),
  mangaTitle: document.querySelector('#mangaTitle'),
  chapterMeta: document.querySelector('#chapterMeta'),
  reader: document.querySelector('#reader'),
  template: document.querySelector('#pageTemplate'),
  downloadTask: document.querySelector('#downloadTaskBtn'),
  copyTask: document.querySelector('#copyTaskBtn'),
  translationFile: document.querySelector('#translationFile'),
  clearTranslation: document.querySelector('#clearTranslationBtn'),
  exportTranslation: document.querySelector('#exportTranslationBtn'),
};

const state = {
  chapter: null,
  translations: new Map(),
};

function setStatus(message, type = '') {
  els.status.textContent = message;
  els.status.className = `status ${type}`.trim();
}

function extractChapterId(value) {
  const input = String(value || '').trim();
  const match = input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (!match) throw new Error('Não encontrei um UUID de capítulo válido.');
  return match[0];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.errors?.[0]?.detail || body?.result || '';
    } catch (_) {}
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  return response.json();
}

function pickTitle(attributes = {}) {
  const title = attributes.title || {};
  const alt = attributes.altTitles || [];
  return (
    title['pt-br'] ||
    title.en ||
    title.ja ||
    title['ja-ro'] ||
    title.zh ||
    title['zh-hk'] ||
    Object.values(title)[0] ||
    alt.flatMap((entry) => Object.values(entry || {}))[0] ||
    'Obra sem título'
  );
}

async function loadChapter() {
  let chapterId;
  try {
    chapterId = extractChapterId(els.input.value);
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }

  els.load.disabled = true;
  els.chapterCard.classList.add('hidden');
  els.reader.innerHTML = '';
  state.chapter = null;
  state.translations.clear();
  setStatus('Buscando capítulo no MangaDex…');

  try {
    const chapterResult = await fetchJson(`${API}/chapter/${chapterId}?includes[]=manga`);
    const chapterData = chapterResult.data;
    const attrs = chapterData.attributes || {};
    const mangaRelation = (chapterData.relationships || []).find((r) => r.type === 'manga');
    if (!mangaRelation) throw new Error('O MangaDex não retornou a obra ligada a este capítulo.');

    let mangaAttributes = mangaRelation.attributes;
    if (!mangaAttributes) {
      const mangaResult = await fetchJson(`${API}/manga/${mangaRelation.id}`);
      mangaAttributes = mangaResult.data?.attributes || {};
    }

    setStatus('Buscando páginas no servidor at-home…');
    const atHome = await fetchJson(`${API}/at-home/server/${chapterId}`);
    const baseUrl = atHome.baseUrl;
    const hash = atHome.chapter?.hash;
    const files = atHome.chapter?.data || [];
    if (!baseUrl || !hash || !files.length) throw new Error('O MangaDex não retornou imagens para este capítulo.');

    const pages = files.map((fileName, index) => ({
      page: index + 1,
      fileName,
      imageUrl: `${baseUrl}/data/${hash}/${fileName}`,
    }));

    state.chapter = {
      schema: 'manga-bridge-chapter/v1',
      source: 'MangaDex',
      chapterId,
      mangaId: mangaRelation.id,
      mangaTitle: pickTitle(mangaAttributes),
      chapterNumber: attrs.chapter || null,
      chapterTitle: attrs.title || null,
      volume: attrs.volume || null,
      sourceLanguage: attrs.translatedLanguage || null,
      pages,
    };

    renderChapter();
    setStatus(`Capítulo carregado: ${pages.length} página${pages.length === 1 ? '' : 's'}.`, 'ok');
  } catch (error) {
    console.error(error);
    setStatus(`Falha ao carregar: ${error.message}`, 'error');
  } finally {
    els.load.disabled = false;
  }
}

function renderChapter() {
  const chapter = state.chapter;
  if (!chapter) return;

  els.mangaTitle.textContent = chapter.mangaTitle;
  const bits = [
    chapter.volume ? `Vol. ${chapter.volume}` : null,
    chapter.chapterNumber ? `Cap. ${chapter.chapterNumber}` : 'Capítulo sem número',
    chapter.chapterTitle || null,
    chapter.sourceLanguage ? `idioma: ${chapter.sourceLanguage}` : null,
    `${chapter.pages.length} páginas`,
  ].filter(Boolean);
  els.chapterMeta.textContent = bits.join(' • ');
  els.chapterCard.classList.remove('hidden');

  els.reader.innerHTML = '';
  for (const page of chapter.pages) {
    const node = els.template.content.cloneNode(true);
    const card = node.querySelector('.page-card');
    card.dataset.page = String(page.page);
    node.querySelector('.page-number').textContent = `Página ${page.page}`;
    const image = node.querySelector('.page-image');
    image.src = page.imageUrl;
    image.alt = `${chapter.mangaTitle} — página ${page.page}`;
    image.addEventListener('error', () => {
      node.querySelector('.page-state').textContent = 'imagem indisponível';
    });
    els.reader.appendChild(node);
  }

  renderTranslations();
}

function buildTask() {
  if (!state.chapter) throw new Error('Carregue um capítulo primeiro.');
  const c = state.chapter;
  return {
    schema: 'manga-bridge-task/v1',
    createdAt: new Date().toISOString(),
    purpose: 'Preparar uma tradução PT-BR com auxílio do ChatGPT, sem API de IA no site.',
    rightsNotice: 'Use somente conteúdo que você criou, possui ou tem autorização para traduzir.',
    chapter: {
      chapterId: c.chapterId,
      mangaId: c.mangaId,
      mangaTitle: c.mangaTitle,
      volume: c.volume,
      chapterNumber: c.chapterNumber,
      chapterTitle: c.chapterTitle,
      sourceLanguage: c.sourceLanguage,
      pages: c.pages,
    },
    requestedOutput: {
      schema: 'manga-bridge-translation/v1',
      chapterId: c.chapterId,
      targetLanguage: 'pt-BR',
      translations: [
        { page: 1, text: 'Texto traduzido da página 1' },
      ],
    },
    instructions: [
      'Analise as páginas na ordem indicada.',
      'Quando permitido, traduza o conteúdo textual para português brasileiro natural e fiel ao contexto.',
      'Preserve nomes próprios, tom, intenção, onomatopeias e continuidade entre páginas quando apropriado.',
      'Retorne somente um JSON compatível com requestedOutput.',
      'O campo page usa numeração começando em 1.',
    ],
  };
}

function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyTask() {
  try {
    const text = JSON.stringify(buildTask(), null, 2);
    await navigator.clipboard.writeText(text);
    setStatus('Tarefa copiada para a área de transferência.', 'ok');
  } catch (error) {
    setStatus(`Não consegui copiar: ${error.message}`, 'error');
  }
}

function downloadTask() {
  try {
    const task = buildTask();
    const short = state.chapter.chapterNumber ? `cap-${state.chapter.chapterNumber}` : state.chapter.chapterId.slice(0, 8);
    downloadJson(task, `manga-bridge-tarefa-${short}.json`);
    setStatus('Tarefa JSON baixada.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function normalizeTranslation(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('JSON inválido.');
  if (!state.chapter) throw new Error('Carregue o capítulo correspondente antes de importar.');
  if (payload.chapterId && payload.chapterId !== state.chapter.chapterId) {
    throw new Error('O chapterId da tradução não corresponde ao capítulo aberto.');
  }

  const rows = payload.translations || payload.pages;
  if (!Array.isArray(rows)) throw new Error('O JSON precisa conter um array "translations".');

  const maxPage = state.chapter.pages.length;
  const map = new Map();
  for (const row of rows) {
    const page = Number(row?.page ?? row?.index);
    const text = row?.text ?? row?.translation ?? row?.translatedText;
    if (!Number.isInteger(page) || page < 1 || page > maxPage) continue;
    if (typeof text !== 'string') continue;
    map.set(page, text.trim());
  }
  if (!map.size) throw new Error('Nenhuma tradução de página válida foi encontrada.');
  return map;
}

function renderTranslations() {
  document.querySelectorAll('.page-card').forEach((card) => {
    const page = Number(card.dataset.page);
    const box = card.querySelector('.translation-box');
    const content = card.querySelector('.translation-content');
    const stateLabel = card.querySelector('.page-state');
    const text = state.translations.get(page);
    if (text) {
      content.textContent = text;
      box.classList.remove('hidden');
      stateLabel.textContent = 'traduzida';
    } else {
      content.textContent = '';
      box.classList.add('hidden');
      stateLabel.textContent = 'original';
    }
  });
}

async function importTranslation(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    state.translations = normalizeTranslation(payload);
    renderTranslations();
    setStatus(`${state.translations.size} página(s) com tradução importada(s).`, 'ok');
  } catch (error) {
    setStatus(`Falha ao importar: ${error.message}`, 'error');
  } finally {
    els.translationFile.value = '';
  }
}

function clearTranslations() {
  state.translations.clear();
  renderTranslations();
  setStatus('Traduções removidas da visualização.');
}

function exportTranslations() {
  if (!state.chapter) {
    setStatus('Carregue um capítulo primeiro.', 'error');
    return;
  }
  const payload = {
    schema: 'manga-bridge-translation/v1',
    chapterId: state.chapter.chapterId,
    targetLanguage: 'pt-BR',
    translations: [...state.translations.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([page, text]) => ({ page, text })),
  };
  downloadJson(payload, `manga-bridge-traducao-${state.chapter.chapterId.slice(0, 8)}.json`);
  setStatus('Tradução atual exportada.', 'ok');
}

els.load.addEventListener('click', loadChapter);
els.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadChapter();
});
els.downloadTask.addEventListener('click', downloadTask);
els.copyTask.addEventListener('click', copyTask);
els.translationFile.addEventListener('change', (event) => importTranslation(event.target.files?.[0]));
els.clearTranslation.addEventListener('click', clearTranslations);
els.exportTranslation.addEventListener('click', exportTranslations);
