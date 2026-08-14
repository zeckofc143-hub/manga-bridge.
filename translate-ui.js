const snippetTranslationState = {
  syncing: false,
};

const SNIPPET_MAX_CHARS = 500;
const SNIPPET_PENDING_KEY = 'mangaBridgePendingSnippet';

function snippetTranslationFileUrl() {
  if (!state.chapter) return null;
  return `./data/${state.chapter.chapterId}.translation.json?v=${Date.now()}`;
}

function snippetTask(region, page) {
  if (!state.chapter) throw new Error('Carregue um capítulo primeiro.');
  const sourceText = String(region?.sourceText || '').trim();
  if (!sourceText) throw new Error('Essa região não tem texto original.');
  if (sourceText.length > SNIPPET_MAX_CHARS) {
    throw new Error(`Trecho grande demais (${sourceText.length} caracteres). Divida a região antes de enviar.`);
  }

  const c = state.chapter;
  return [
    'MANGABRIDGE_SNIPPET_V1',
    `repository: zeckofc143-hub/manga-bridge.`,
    `chapterId: ${c.chapterId}`,
    `page: ${page}`,
    `regionId: ${region.id}`,
    `type: ${region.type || 'other'}`,
    `sourceLanguage: ${c.sourceLanguage || 'unknown'}`,
    'targetLanguage: pt-BR',
    '',
    'sourceText:',
    '<<<',
    sourceText,
    '>>>',
    '',
    'Pedido: traduza SOMENTE este trecho curto para PT-BR. Depois, usando o GitHub conectado, crie ou mescle SOMENTE esta região em data/' + c.chapterId + '.translation.json no schema manga-bridge-snippet-translations/v1. Preserve as outras regiões já existentes. Não altere posição, OCR, typer ou redraw. Ao terminar, diga que sincronizou no MangaBridge.'
  ].join('\n');
}

async function copyTextPortable(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  }
}

function writePendingSnippet(region, page) {
  if (!state.chapter) return;
  localStorage.setItem(SNIPPET_PENDING_KEY, JSON.stringify({
    chapterId: state.chapter.chapterId,
    page,
    regionId: region.id,
    at: Date.now(),
  }));
}

function readPendingSnippet() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SNIPPET_PENDING_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function payloadHasRegion(payload, page, regionId) {
  const row = Array.isArray(payload?.pages) ? payload.pages.find((item) => Number(item?.page) === Number(page)) : null;
  return Boolean(row && Array.isArray(row.regions) && row.regions.some((region) => String(region?.id) === String(regionId) && String(region?.translatedText || '').trim()));
}

function showCleanTranslatedPreview() {
  window.mangaBridgeTyper?.showPreview?.(true);
  window.mangaBridgeTyper?.showBoxes?.(false);
  window.mangaBridgeRedraw?.showMasks?.(false);
  window.mangaBridgeRedraw?.show?.(true);
}

function focusTranslatedRegion(pending) {
  if (!pending || !state.chapter || pending.chapterId !== state.chapter.chapterId) return;
  const card = document.querySelector(`.page-card[data-page="${pending.page}"]`);
  if (!card) return;
  const target = card.querySelector(`[data-region-id="${CSS.escape(String(pending.regionId))}"]`) || card;
  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

async function syncPublishedTranslations(options = {}) {
  if (!state.chapter || snippetTranslationState.syncing) return false;
  const { quiet = false, poll = false } = options;
  snippetTranslationState.syncing = true;
  const attempts = poll ? 12 : 1;
  const pending = readPendingSnippet();

  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const url = snippetTranslationFileUrl();
      const response = await fetch(url, { cache: 'no-store' });

      if (response.status === 404) {
        if (attempt < attempts) {
          if (!quiet) setStatus(`Aguardando tradução publicada… ${attempt}/${attempts}`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        if (!quiet) setStatus('Ainda não há tradução publicada para este capítulo.');
        return false;
      }

      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload = await response.json();
      if (payload?.chapterId !== state.chapter.chapterId) throw new Error('chapterId da tradução publicada é diferente.');
      if (!Array.isArray(payload?.pages)) throw new Error('Arquivo de tradução sem pages.');

      const changed = mergeTranslationPayload(payload);
      writeTyperPrefs?.();
      persistDraft();
      renderAllRegions();
      showCleanTranslatedPreview();

      const completedPending = pending && pending.chapterId === state.chapter.chapterId && payloadHasRegion(payload, pending.page, pending.regionId);
      if (completedPending) {
        localStorage.removeItem(SNIPPET_PENDING_KEY);
        setTimeout(() => focusTranslatedRegion(pending), 100);
      }

      setStatus(`${changed} região(ões) sincronizada(s). Prévia limpa ativada: PT-BR + redraw ON, caixas OCR OFF.`, 'ok');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Falha ao sincronizar traduções:', error);
    if (!quiet) setStatus(`Falha ao sincronizar tradução: ${error.message}`, 'error');
    return false;
  } finally {
    snippetTranslationState.syncing = false;
  }
}

function ensureSnippetToolbar() {
  const tools = document.querySelector('.translation-tools');
  if (!tools || document.querySelector('#syncSnippetTranslationsBtn')) return;

  const sync = document.createElement('button');
  sync.id = 'syncSnippetTranslationsBtn';
  sync.className = 'primary';
  sync.type = 'button';
  sync.textContent = 'Sincronizar traduções';
  sync.addEventListener('click', () => syncPublishedTranslations({ poll: Boolean(readPendingSnippet()) }));
  tools.prepend(sync);
}

function decorateSnippetControls(page) {
  const card = document.querySelector(`.page-card[data-page="${page}"]`);
  if (!card) return;
  const regions = getPageRegions(page);
  const cards = card.querySelectorAll('.region-card');

  cards.forEach((regionCard, index) => {
    const region = regions[index];
    if (!region || regionCard.querySelector('.snippet-panel')) return;

    const source = String(region.sourceText || '').trim();
    const panel = document.createElement('div');
    panel.className = 'snippet-panel';
    panel.innerHTML = `
      <div class="snippet-head">
        <strong>ChatGPT</strong>
        <span class="tiny muted">tradução por trecho • ${source.length}/${SNIPPET_MAX_CHARS} caracteres</span>
      </div>
      <button class="snippet-copy primary" type="button"${!source || source.length > SNIPPET_MAX_CHARS ? ' disabled' : ''}>Copiar trecho para ChatGPT</button>
      <p class="tiny muted snippet-hint">Depois de eu sincronizar no GitHub, volte ao site e toque em “Sincronizar traduções”.</p>`;

    const button = panel.querySelector('.snippet-copy');
    button?.addEventListener('click', async () => {
      try {
        const task = snippetTask(region, page);
        const ok = await copyTextPortable(task);
        if (!ok) throw new Error('o navegador não permitiu copiar');
        writePendingSnippet(region, page);
        button.textContent = 'Trecho copiado ✓';
        setStatus(`Trecho ${region.id} copiado. Cole aqui no ChatGPT; quando voltar, a tradução pode ser sincronizada.`, 'ok');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    regionCard.appendChild(panel);
  });
}

const snippetBaseRenderPageRegions = renderPageRegions;
renderPageRegions = function renderPageRegionsWithSnippetBridge(page) {
  snippetBaseRenderPageRegions(page);
  ensureSnippetToolbar();
  decorateSnippetControls(page);
};

ensureSnippetToolbar();

window.addEventListener('focus', () => {
  const pending = readPendingSnippet();
  if (!pending || !state.chapter || pending.chapterId !== state.chapter.chapterId) return;
  setTimeout(() => syncPublishedTranslations({ quiet: true, poll: true }), 500);
});

window.mangaBridgeTranslate = {
  sync: syncPublishedTranslations,
  buildSnippetTask: snippetTask,
  maxChars: SNIPPET_MAX_CHARS,
};
