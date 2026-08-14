const OCR_POLL_MS = 150;
const OCR_POLL_TRIES = 100;

function hasAnyRegions() {
  return [...state.regions.values()].some((regions) => Array.isArray(regions) && regions.length > 0);
}

function countRegions() {
  return [...state.regions.values()].reduce((sum, regions) => sum + (Array.isArray(regions) ? regions.length : 0), 0);
}

async function loadAutomaticOcr() {
  if (!state.chapter) return false;
  if (hasAnyRegions()) return true;

  const chapterId = state.chapter.chapterId;
  try {
    const response = await fetch(`./data/${chapterId}.ocr.json?v=${Date.now()}`, { cache: 'no-store' });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const ocr = await response.json();
    if (!Array.isArray(ocr.pages)) throw new Error('OCR sem array pages.');

    state.regions = normalizeTranslation({
      schema: 'manga-bridge-translation/v2',
      chapterId,
      targetLanguage: 'pt-BR',
      pages: ocr.pages,
    }, false);

    renderAllRegions();
    persistDraft();
    const total = countRegions();
    setStatus(`OCR automático carregado: ${total} regiões detectadas em ${state.chapter.pages.length} páginas.`, 'ok');
    return true;
  } catch (error) {
    console.error('Falha ao carregar OCR automático:', error);
    setStatus(`Capítulo carregado, mas o OCR automático falhou: ${error.message}`, 'error');
    return false;
  }
}

async function waitForChapterThenOcr() {
  const expectedId = (() => {
    try { return extractChapterId(els.input.value); } catch (_) { return null; }
  })();
  if (!expectedId) return;

  for (let i = 0; i < OCR_POLL_TRIES; i += 1) {
    if (state.chapter?.chapterId === expectedId) {
      await loadAutomaticOcr();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, OCR_POLL_MS));
  }
}

els.load.addEventListener('click', () => {
  waitForChapterThenOcr();
});

els.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') waitForChapterThenOcr();
});

window.addEventListener('focus', () => {
  waitForChapterThenOcr();
});

window.mangaBridgeLoadOcr = loadAutomaticOcr;
