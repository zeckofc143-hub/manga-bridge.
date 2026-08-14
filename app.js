const els = {
  input: document.querySelector('#chapterInput'),
  load: document.querySelector('#loadBtn'),
  status: document.querySelector('#status'),
  requestActions: document.querySelector('#requestActions'),
  requestBtn: document.querySelector('#requestBtn'),
  checkCache: document.querySelector('#checkCacheBtn'),
  requestHint: document.querySelector('#requestHint'),
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
  regions: new Map(),
  pendingId: null,
};

const REGION_TYPES = ['dialogue', 'thought', 'narration', 'sfx', 'sign', 'other'];

function setStatus(message, type = '') {
  els.status.textContent = message;
  els.status.className = `status ${type}`.trim();
}

function extractChapterId(value) {
  const match = String(value || '').trim().match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (!match) throw new Error('Não encontrei um UUID de capítulo válido.');
  return match[0];
}

function requestUrl(id) {
  const title = `MangaBridge: ${id}`;
  const body = `Preparar capítulo https://mangadex.org/chapter/${id}`;
  return `https://github.com/zeckofc143-hub/manga-bridge./issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function hideRequest() {
  els.requestActions.classList.add('hidden');
  els.requestHint.classList.add('hidden');
}

function showRequest(id) {
  state.pendingId = id;
  localStorage.setItem('mangaBridgePending', id);
  els.requestBtn.href = requestUrl(id);
  els.requestActions.classList.remove('hidden');
  els.requestHint.classList.remove('hidden');
}

function draftKey() {
  return state.chapter ? `mangaBridgeDraft:${state.chapter.chapterId}` : null;
}

function persistDraft() {
  const key = draftKey();
  if (!key) return;
  const pages = [...state.regions.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, regions]) => ({ page, regions }));
  localStorage.setItem(key, JSON.stringify({ schema: 'manga-bridge-translation/v2', pages }));
}

function restoreDraft() {
  const key = draftKey();
  if (!key) return false;
  const raw = localStorage.getItem(key);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    const map = normalizeTranslation(parsed, false);
    state.regions = map;
    return true;
  } catch (error) {
    console.warn('Rascunho local inválido:', error);
    return false;
  }
}

async function loadChapter() {
  let id;
  try {
    id = extractChapterId(els.input.value);
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }

  els.load.disabled = true;
  els.chapterCard.classList.add('hidden');
  els.reader.innerHTML = '';
  state.chapter = null;
  state.regions.clear();
  hideRequest();
  setStatus('Procurando capítulo preparado no GitHub…');

  try {
    const response = await fetch(`./data/${id}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (response.status === 404) {
      showRequest(id);
      setStatus('Esse capítulo ainda não foi preparado. Toque em “Preparar pelo GitHub”, envie a issue e depois volte para verificar.', 'error');
      return;
    }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const chapter = await response.json();
    if (!chapter?.pages?.length) throw new Error('Cache do capítulo está vazio.');

    state.chapter = chapter;
    localStorage.removeItem('mangaBridgePending');
    state.pendingId = null;
    const restored = restoreDraft();
    renderChapter();
    setStatus(`Capítulo carregado: ${chapter.pages.length} páginas${restored ? ' • rascunho restaurado' : ''}.`, 'ok');
  } catch (error) {
    console.error(error);
    setStatus(`Falha ao carregar cache: ${error.message}`, 'error');
  } finally {
    els.load.disabled = false;
  }
}

function getPageRegions(page) {
  if (!state.regions.has(page)) state.regions.set(page, []);
  return state.regions.get(page);
}

function nextRegionId(page) {
  const regions = getPageRegions(page);
  let n = regions.length + 1;
  while (regions.some((r) => r.id === `p${page}-r${n}`)) n += 1;
  return `p${page}-r${n}`;
}

function makeRegion(page) {
  return {
    id: nextRegionId(page),
    type: 'dialogue',
    sourceText: '',
    translatedText: '',
    bounds: { x: 10, y: 10, width: 35, height: 12 },
  };
}

function clampPercent(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

function sanitizeRegion(region, page, index) {
  const b = region?.bounds || region?.box || {};
  return {
    id: String(region?.id || `p${page}-r${index + 1}`),
    type: REGION_TYPES.includes(region?.type) ? region.type : 'other',
    sourceText: String(region?.sourceText ?? region?.originalText ?? region?.source ?? ''),
    translatedText: String(region?.translatedText ?? region?.translation ?? region?.text ?? ''),
    bounds: {
      x: clampPercent(b.x, 10),
      y: clampPercent(b.y, 10),
      width: clampPercent(b.width ?? b.w, 35),
      height: clampPercent(b.height ?? b.h, 12),
    },
  };
}

function renderChapter() {
  const c = state.chapter;
  els.mangaTitle.textContent = c.mangaTitle || 'Obra sem título';
  els.chapterMeta.textContent = [
    c.volume ? `Vol. ${c.volume}` : null,
    c.chapterNumber ? `Cap. ${c.chapterNumber}` : 'Capítulo sem número',
    c.chapterTitle || null,
    c.sourceLanguage ? `idioma: ${c.sourceLanguage}` : null,
    `${c.pages.length} páginas`,
  ].filter(Boolean).join(' • ');
  els.chapterCard.classList.remove('hidden');
  els.reader.innerHTML = '';

  for (const p of c.pages) {
    const node = els.template.content.cloneNode(true);
    const card = node.querySelector('.page-card');
    card.dataset.page = String(p.page);
    node.querySelector('.page-number').textContent = `Página ${p.page}`;

    const img = node.querySelector('.page-image');
    img.src = p.imageUrl;
    img.alt = `${c.mangaTitle} — página ${p.page}`;
    img.addEventListener('error', () => {
      card.querySelector('.page-state').textContent = 'imagem indisponível';
    });

    node.querySelector('.add-region').addEventListener('click', () => {
      const regions = getPageRegions(p.page);
      regions.push(makeRegion(p.page));
      persistDraft();
      renderPageRegions(p.page);
      setStatus(`Balão adicionado na página ${p.page}.`, 'ok');
    });

    els.reader.appendChild(node);
  }

  renderAllRegions();
}

function renderAllRegions() {
  document.querySelectorAll('.page-card').forEach((card) => {
    renderPageRegions(Number(card.dataset.page));
  });
}

function renderPageRegions(page) {
  const card = document.querySelector(`.page-card[data-page="${page}"]`);
  if (!card) return;

  const regions = getPageRegions(page);
  const editor = card.querySelector('.regions-editor');
  const overlay = card.querySelector('.regions-overlay');
  const stateLabel = card.querySelector('.page-state');

  editor.innerHTML = '';
  overlay.innerHTML = '';
  stateLabel.textContent = `${regions.length} ${regions.length === 1 ? 'balão' : 'balões'}`;

  regions.forEach((region, index) => {
    const rect = document.createElement('div');
    rect.className = 'region-rect';
    rect.style.left = `${region.bounds.x}%`;
    rect.style.top = `${region.bounds.y}%`;
    rect.style.width = `${region.bounds.width}%`;
    rect.style.height = `${region.bounds.height}%`;
    rect.innerHTML = `<span>${index + 1}</span>`;
    overlay.appendChild(rect);

    const regionCard = document.createElement('div');
    regionCard.className = 'region-card';
    regionCard.innerHTML = `
      <div class="region-head">
        <div class="region-title">Balão ${index + 1} <span class="muted">${escapeHtml(region.id)}</span></div>
        <button class="danger remove-region" type="button">Remover</button>
      </div>
      <div class="region-grid">
        <div class="field half">
          <label>Tipo</label>
          <select data-field="type">
            ${REGION_TYPES.map((type) => `<option value="${type}"${type === region.type ? ' selected' : ''}>${type}</option>`).join('')}
          </select>
        </div>
        <div class="field half">
          <label>ID</label>
          <input data-field="id" value="${escapeAttr(region.id)}" />
        </div>
        <div class="field wide">
          <label>Texto original</label>
          <textarea data-field="sourceText" placeholder="Texto detectado no balão">${escapeHtml(region.sourceText)}</textarea>
        </div>
        <div class="field wide">
          <label>Tradução PT-BR</label>
          <textarea data-field="translatedText" placeholder="Tradução deste balão">${escapeHtml(region.translatedText)}</textarea>
        </div>
        <div class="field"><label>X %</label><input data-bound="x" type="number" min="0" max="100" step="0.1" value="${region.bounds.x}" /></div>
        <div class="field"><label>Y %</label><input data-bound="y" type="number" min="0" max="100" step="0.1" value="${region.bounds.y}" /></div>
        <div class="field"><label>Largura %</label><input data-bound="width" type="number" min="0" max="100" step="0.1" value="${region.bounds.width}" /></div>
        <div class="field"><label>Altura %</label><input data-bound="height" type="number" min="0" max="100" step="0.1" value="${region.bounds.height}" /></div>
      </div>`;

    regionCard.querySelector('.remove-region').addEventListener('click', () => {
      regions.splice(index, 1);
      persistDraft();
      renderPageRegions(page);
      setStatus(`Balão removido da página ${page}.`);
    });

    regionCard.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        region[input.dataset.field] = input.value;
        persistDraft();
      });
    });

    regionCard.querySelectorAll('[data-bound]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.bound;
        region.bounds[key] = clampPercent(input.value, region.bounds[key]);
        persistDraft();
        const rects = overlay.querySelectorAll('.region-rect');
        const target = rects[index];
        if (target) {
          target.style.left = `${region.bounds.x}%`;
          target.style.top = `${region.bounds.y}%`;
          target.style.width = `${region.bounds.width}%`;
          target.style.height = `${region.bounds.height}%`;
        }
      });
    });

    editor.appendChild(regionCard);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

function buildTask() {
  if (!state.chapter) throw new Error('Carregue um capítulo primeiro.');
  const c = state.chapter;
  return {
    schema: 'manga-bridge-task/v2',
    createdAt: new Date().toISOString(),
    purpose: 'Estruturar texto por balões/regiões para tradução PT-BR e posterior typesetting.',
    chapter: {
      chapterId: c.chapterId,
      mangaId: c.mangaId,
      mangaTitle: c.mangaTitle,
      volume: c.volume,
      chapterNumber: c.chapterNumber,
      chapterTitle: c.chapterTitle,
      sourceLanguage: c.sourceLanguage,
      pages: c.pages.map((p) => ({
        page: p.page,
        fileName: p.fileName,
        imageUrl: p.imageUrl,
        regions: getPageRegions(p.page),
      })),
    },
    requestedOutput: {
      schema: 'manga-bridge-translation/v2',
      chapterId: c.chapterId,
      targetLanguage: 'pt-BR',
      pages: [
        {
          page: 1,
          regions: [
            {
              id: 'p1-r1',
              type: 'dialogue',
              sourceText: 'Original',
              translatedText: 'Tradução',
              bounds: { x: 10, y: 10, width: 35, height: 12 },
            },
          ],
        },
      ],
    },
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
    await navigator.clipboard.writeText(JSON.stringify(buildTask(), null, 2));
    setStatus('Tarefa v2 copiada.', 'ok');
  } catch (error) {
    setStatus(`Não consegui copiar: ${error.message}`, 'error');
  }
}

function downloadTask() {
  try {
    downloadJson(buildTask(), `manga-bridge-tarefa-v2-${state.chapter.chapterId.slice(0, 8)}.json`);
    setStatus('Tarefa v2 baixada.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function normalizeTranslation(payload, requireAny = true) {
  if (!state.chapter) throw new Error('Carregue o capítulo primeiro.');
  if (payload?.chapterId && payload.chapterId !== state.chapter.chapterId) {
    throw new Error('chapterId diferente do capítulo aberto.');
  }

  const map = new Map();

  if (payload?.schema === 'manga-bridge-translation/v2' || Array.isArray(payload?.pages)) {
    const pages = Array.isArray(payload.pages) ? payload.pages : [];
    for (const row of pages) {
      const page = Number(row?.page);
      if (!Number.isInteger(page) || page < 1 || page > state.chapter.pages.length) continue;
      const regions = Array.isArray(row?.regions) ? row.regions.map((region, index) => sanitizeRegion(region, page, index)) : [];
      if (regions.length) map.set(page, regions);
    }
  } else {
    const rows = payload?.translations;
    if (!Array.isArray(rows)) throw new Error('JSON sem pages/regions ou translations.');
    for (const row of rows) {
      const page = Number(row?.page ?? row?.index);
      const text = row?.text ?? row?.translation ?? row?.translatedText;
      if (!Number.isInteger(page) || page < 1 || page > state.chapter.pages.length || typeof text !== 'string') continue;
      map.set(page, [{
        id: `p${page}-legacy1`,
        type: 'other',
        sourceText: '',
        translatedText: text.trim(),
        bounds: { x: 10, y: 10, width: 80, height: 12 },
      }]);
    }
  }

  if (requireAny && ![...map.values()].some((regions) => regions.length)) {
    throw new Error('Nenhum balão/região válido encontrado.');
  }
  return map;
}

async function importTranslation(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    state.regions = normalizeTranslation(payload);
    persistDraft();
    renderAllRegions();
    const total = [...state.regions.values()].reduce((sum, regions) => sum + regions.length, 0);
    setStatus(`${total} balão(ões) importado(s).`, 'ok');
  } catch (error) {
    setStatus(`Falha ao importar: ${error.message}`, 'error');
  } finally {
    els.translationFile.value = '';
  }
}

function clearTranslations() {
  state.regions.clear();
  const key = draftKey();
  if (key) localStorage.removeItem(key);
  renderAllRegions();
  setStatus('Balões removidos.');
}

function exportTranslations() {
  if (!state.chapter) {
    setStatus('Carregue um capítulo primeiro.', 'error');
    return;
  }

  const pages = state.chapter.pages
    .map((p) => ({ page: p.page, regions: getPageRegions(p.page) }))
    .filter((row) => row.regions.length);

  const payload = {
    schema: 'manga-bridge-translation/v2',
    chapterId: state.chapter.chapterId,
    targetLanguage: 'pt-BR',
    pages,
  };

  downloadJson(payload, `manga-bridge-traducao-v2-${state.chapter.chapterId.slice(0, 8)}.json`);
  setStatus('JSON v2 exportado.', 'ok');
}

els.load.addEventListener('click', loadChapter);
els.input.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadChapter(); });
els.requestBtn.addEventListener('click', () => setStatus('Envie a issue no GitHub. Quando voltar, toque em “Verificar novamente”.'));
els.checkCache.addEventListener('click', loadChapter);
els.downloadTask.addEventListener('click', downloadTask);
els.copyTask.addEventListener('click', copyTask);
els.translationFile.addEventListener('change', (event) => importTranslation(event.target.files?.[0]));
els.clearTranslation.addEventListener('click', clearTranslations);
els.exportTranslation.addEventListener('click', exportTranslations);

const pending = localStorage.getItem('mangaBridgePending');
if (pending) {
  els.input.value = `https://mangadex.org/chapter/${pending}`;
  showRequest(pending);
}

window.addEventListener('focus', () => {
  if (localStorage.getItem('mangaBridgePending')) loadChapter();
});
