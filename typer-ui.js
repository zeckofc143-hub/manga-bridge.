const typerUiState = {
  preview: true,
  boxes: true,
};

const TYPER_FONTS = {
  sans: 'Arial, Helvetica, sans-serif',
  comic: '"Comic Sans MS", "Trebuchet MS", sans-serif',
  impact: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  condensed: '"Arial Narrow", Arial, sans-serif',
};

function typerClamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function defaultTyperStyle(type = 'other') {
  if (type === 'sfx') {
    return {
      fontSize: 5.2,
      rotation: 0,
      align: 'center',
      font: 'impact',
      color: '#ffffff',
      strokeColor: '#111111',
      strokeWidth: 2,
      background: 'none',
      weight: 900,
    };
  }

  if (type === 'dialogue' || type === 'thought') {
    return {
      fontSize: 3.1,
      rotation: 0,
      align: 'center',
      font: 'comic',
      color: '#111111',
      strokeColor: '#ffffff',
      strokeWidth: 0,
      background: 'white',
      weight: 700,
    };
  }

  if (type === 'narration') {
    return {
      fontSize: 2.9,
      rotation: 0,
      align: 'center',
      font: 'sans',
      color: '#ffffff',
      strokeColor: '#111111',
      strokeWidth: 1,
      background: 'dark',
      weight: 800,
    };
  }

  if (type === 'sign') {
    return {
      fontSize: 3.5,
      rotation: 0,
      align: 'center',
      font: 'sans',
      color: '#ffffff',
      strokeColor: '#111111',
      strokeWidth: 1,
      background: 'none',
      weight: 800,
    };
  }

  return {
    fontSize: 3.0,
    rotation: 0,
    align: 'center',
    font: 'sans',
    color: '#ffffff',
    strokeColor: '#111111',
    strokeWidth: 1,
    background: 'none',
    weight: 700,
  };
}

function normalizeTyperStyle(value, type) {
  const base = defaultTyperStyle(type);
  const style = value && typeof value === 'object' ? value : {};
  return {
    fontSize: typerClamp(style.fontSize, 0.8, 12, base.fontSize),
    rotation: typerClamp(style.rotation, -180, 180, base.rotation),
    align: ['left', 'center', 'right'].includes(style.align) ? style.align : base.align,
    font: Object.hasOwn(TYPER_FONTS, style.font) ? style.font : base.font,
    color: /^#[0-9a-f]{6}$/i.test(style.color || '') ? style.color : base.color,
    strokeColor: /^#[0-9a-f]{6}$/i.test(style.strokeColor || '') ? style.strokeColor : base.strokeColor,
    strokeWidth: typerClamp(style.strokeWidth, 0, 6, base.strokeWidth),
    background: ['none', 'white', 'dark'].includes(style.background) ? style.background : base.background,
    weight: typerClamp(style.weight, 400, 900, base.weight),
  };
}

function typerStorageKey() {
  return state.chapter ? `mangaBridgeTyper:${state.chapter.chapterId}` : null;
}

function readTyperPrefs() {
  const key = typerStorageKey();
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function writeTyperPrefs() {
  const key = typerStorageKey();
  if (!key) return;
  const data = {};
  for (const regions of state.regions.values()) {
    for (const region of regions || []) {
      if (region?.id && region?.typer) data[region.id] = normalizeTyperStyle(region.typer, region.type);
    }
  }
  localStorage.setItem(key, JSON.stringify(data));
}

function ensureTyper(region) {
  if (!region) return defaultTyperStyle('other');
  if (!region.typer) {
    const saved = readTyperPrefs()[region.id];
    region.typer = normalizeTyperStyle(saved, region.type);
  } else {
    region.typer = normalizeTyperStyle(region.typer, region.type);
  }
  return region.typer;
}

function backgroundStyle(kind) {
  if (kind === 'white') return 'rgba(255,255,255,.94)';
  if (kind === 'dark') return 'rgba(8,10,15,.82)';
  return 'transparent';
}

function syncTyperButtons() {
  const previewBtn = document.querySelector('#toggleTyperPreviewBtn');
  const boxesBtn = document.querySelector('#toggleOcrBoxesBtn');
  if (previewBtn) previewBtn.textContent = `Prévia PT-BR: ${typerUiState.preview ? 'ON' : 'OFF'}`;
  if (boxesBtn) boxesBtn.textContent = `Caixas OCR: ${typerUiState.boxes ? 'ON' : 'OFF'}`;

  document.querySelectorAll('.translation-layer').forEach((layer) => {
    layer.classList.toggle('hidden', !typerUiState.preview);
  });
  document.querySelectorAll('.regions-overlay').forEach((layer) => {
    layer.classList.toggle('hidden', !typerUiState.boxes);
  });
}

function ensureTyperToolbar() {
  const tools = document.querySelector('.translation-tools');
  if (!tools || document.querySelector('#toggleTyperPreviewBtn')) return;

  const preview = document.createElement('button');
  preview.id = 'toggleTyperPreviewBtn';
  preview.className = 'ghost';
  preview.type = 'button';
  preview.addEventListener('click', () => {
    typerUiState.preview = !typerUiState.preview;
    syncTyperButtons();
  });

  const boxes = document.createElement('button');
  boxes.id = 'toggleOcrBoxesBtn';
  boxes.className = 'ghost';
  boxes.type = 'button';
  boxes.addEventListener('click', () => {
    typerUiState.boxes = !typerUiState.boxes;
    syncTyperButtons();
  });

  const auto = document.createElement('button');
  auto.id = 'autoTyperBtn';
  auto.className = 'ghost';
  auto.type = 'button';
  auto.textContent = 'Autoestilo do typer';
  auto.addEventListener('click', () => {
    let changed = 0;
    for (const regions of state.regions.values()) {
      for (const region of regions || []) {
        region.typer = defaultTyperStyle(region.type);
        changed += 1;
      }
    }
    writeTyperPrefs();
    persistDraft();
    renderAllRegions();
    setStatus(`Autoestilo aplicado em ${changed} regiões.`, 'ok');
  });

  tools.append(preview, boxes, auto);
  syncTyperButtons();
}

function ensureTranslationLayer(card) {
  const wrap = card?.querySelector('.image-wrap');
  if (!wrap) return null;
  let layer = wrap.querySelector('.translation-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'translation-layer';
    wrap.appendChild(layer);
  }
  return layer;
}

function positionTyperElement(el, region) {
  el.style.left = `${region.bounds.x}%`;
  el.style.top = `${region.bounds.y}%`;
  el.style.width = `${region.bounds.width}%`;
  el.style.height = `${region.bounds.height}%`;
}

function attachTyperDrag(el, region, page) {
  el.addEventListener('pointerdown', (event) => {
    if (!typerUiState.preview) return;
    event.preventDefault();
    el.setPointerCapture?.(event.pointerId);

    const card = document.querySelector(`.page-card[data-page="${page}"]`);
    const wrap = card?.querySelector('.image-wrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originalX = region.bounds.x;
    const originalY = region.bounds.y;

    const move = (moveEvent) => {
      const dx = ((moveEvent.clientX - startX) / Math.max(1, rect.width)) * 100;
      const dy = ((moveEvent.clientY - startY) / Math.max(1, rect.height)) * 100;
      region.bounds.x = typerClamp(originalX + dx, 0, Math.max(0, 100 - region.bounds.width), originalX);
      region.bounds.y = typerClamp(originalY + dy, 0, Math.max(0, 100 - region.bounds.height), originalY);
      positionTyperElement(el, region);

      const editor = card.querySelector('.regions-editor');
      const regionIndex = getPageRegions(page).indexOf(region);
      const regionCard = editor?.querySelectorAll('.region-card')?.[regionIndex];
      const xInput = regionCard?.querySelector('[data-bound="x"]');
      const yInput = regionCard?.querySelector('[data-bound="y"]');
      if (xInput) xInput.value = region.bounds.x.toFixed(2);
      if (yInput) yInput.value = region.bounds.y.toFixed(2);
    };

    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      persistDraft();
      renderPageRegions(page);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
    window.addEventListener('pointercancel', end, { once: true });
  });
}

function renderTyperLayer(page) {
  const card = document.querySelector(`.page-card[data-page="${page}"]`);
  if (!card) return;
  const layer = ensureTranslationLayer(card);
  if (!layer) return;
  layer.innerHTML = '';

  for (const region of getPageRegions(page)) {
    const text = String(region.translatedText || '').trim();
    if (!text) continue;

    const style = ensureTyper(region);
    const el = document.createElement('div');
    el.className = `translation-text translation-${region.type || 'other'}`;
    el.textContent = text;
    el.dataset.regionId = region.id;
    positionTyperElement(el, region);
    el.style.fontSize = `${style.fontSize}cqw`;
    el.style.fontFamily = TYPER_FONTS[style.font] || TYPER_FONTS.sans;
    el.style.fontWeight = String(style.weight);
    el.style.textAlign = style.align;
    el.style.justifyContent = style.align === 'left' ? 'flex-start' : style.align === 'right' ? 'flex-end' : 'center';
    el.style.color = style.color;
    el.style.background = backgroundStyle(style.background);
    el.style.webkitTextStroke = style.strokeWidth ? `${style.strokeWidth}px ${style.strokeColor}` : '0 transparent';
    el.style.textShadow = style.strokeWidth ? `0 1px 1px ${style.strokeColor}` : 'none';
    el.style.transform = `rotate(${style.rotation}deg)`;
    attachTyperDrag(el, region, page);
    layer.appendChild(el);
  }

  layer.classList.toggle('hidden', !typerUiState.preview);
  const boxes = card.querySelector('.regions-overlay');
  boxes?.classList.toggle('hidden', !typerUiState.boxes);
}

function decorateTyperControls(page) {
  const card = document.querySelector(`.page-card[data-page="${page}"]`);
  if (!card) return;
  const regions = getPageRegions(page);
  const cards = card.querySelectorAll('.region-card');

  cards.forEach((regionCard, index) => {
    const region = regions[index];
    if (!region || regionCard.querySelector('.typer-panel')) return;
    const style = ensureTyper(region);

    const panel = document.createElement('div');
    panel.className = 'typer-panel';
    panel.innerHTML = `
      <div class="typer-head">
        <strong>Typer</strong>
        <span class="tiny muted">arraste a tradução na imagem para mover</span>
      </div>
      <div class="typer-grid">
        <div class="field"><label>Fonte %</label><input data-typer="fontSize" type="number" min="0.8" max="12" step="0.1" value="${style.fontSize}" /></div>
        <div class="field"><label>Rotação °</label><input data-typer="rotation" type="number" min="-180" max="180" step="1" value="${style.rotation}" /></div>
        <div class="field"><label>Alinhamento</label><select data-typer="align"><option value="left"${style.align === 'left' ? ' selected' : ''}>esquerda</option><option value="center"${style.align === 'center' ? ' selected' : ''}>centro</option><option value="right"${style.align === 'right' ? ' selected' : ''}>direita</option></select></div>
        <div class="field"><label>Fonte</label><select data-typer="font"><option value="sans"${style.font === 'sans' ? ' selected' : ''}>Sans</option><option value="comic"${style.font === 'comic' ? ' selected' : ''}>Comic</option><option value="impact"${style.font === 'impact' ? ' selected' : ''}>Impact</option><option value="serif"${style.font === 'serif' ? ' selected' : ''}>Serif</option><option value="condensed"${style.font === 'condensed' ? ' selected' : ''}>Condensada</option></select></div>
        <div class="field"><label>Cor</label><input data-typer="color" type="color" value="${style.color}" /></div>
        <div class="field"><label>Contorno</label><input data-typer="strokeColor" type="color" value="${style.strokeColor}" /></div>
        <div class="field"><label>Espessura</label><input data-typer="strokeWidth" type="number" min="0" max="6" step="1" value="${style.strokeWidth}" /></div>
        <div class="field"><label>Fundo</label><select data-typer="background"><option value="none"${style.background === 'none' ? ' selected' : ''}>nenhum</option><option value="white"${style.background === 'white' ? ' selected' : ''}>branco</option><option value="dark"${style.background === 'dark' ? ' selected' : ''}>escuro</option></select></div>
      </div>
      <button class="ghost typer-reset" type="button">Restaurar estilo automático</button>`;

    panel.querySelectorAll('[data-typer]').forEach((input) => {
      const update = () => {
        const key = input.dataset.typer;
        if (key === 'fontSize') style[key] = typerClamp(input.value, 0.8, 12, style[key]);
        else if (key === 'rotation') style[key] = typerClamp(input.value, -180, 180, style[key]);
        else if (key === 'strokeWidth') style[key] = typerClamp(input.value, 0, 6, style[key]);
        else style[key] = input.value;
        region.typer = normalizeTyperStyle(style, region.type);
        writeTyperPrefs();
        persistDraft();
        renderTyperLayer(page);
      };
      input.addEventListener('input', update);
      input.addEventListener('change', update);
    });

    panel.querySelector('.typer-reset').addEventListener('click', () => {
      region.typer = defaultTyperStyle(region.type);
      writeTyperPrefs();
      persistDraft();
      renderPageRegions(page);
      setStatus(`Estilo automático restaurado em ${region.id}.`, 'ok');
    });

    const translated = regionCard.querySelector('[data-field="translatedText"]');
    translated?.addEventListener('input', () => renderTyperLayer(page));

    regionCard.querySelectorAll('[data-bound]').forEach((input) => {
      input.addEventListener('input', () => renderTyperLayer(page));
    });

    const typeSelect = regionCard.querySelector('[data-field="type"]');
    typeSelect?.addEventListener('change', () => {
      region.typer = normalizeTyperStyle(region.typer, region.type);
      writeTyperPrefs();
      renderTyperLayer(page);
    });

    regionCard.appendChild(panel);
  });
}

function mergeTranslationPayload(payload) {
  if (!state.chapter) throw new Error('Carregue o capítulo primeiro.');
  if (payload?.chapterId && payload.chapterId !== state.chapter.chapterId) {
    throw new Error('chapterId diferente do capítulo aberto.');
  }

  const rows = Array.isArray(payload?.pages) ? payload.pages : [];
  let changed = 0;

  for (const row of rows) {
    const page = Number(row?.page);
    if (!Number.isInteger(page) || page < 1 || page > state.chapter.pages.length) continue;
    const incoming = Array.isArray(row?.regions) ? row.regions : [];
    const current = getPageRegions(page);

    incoming.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const id = item.id != null ? String(item.id) : null;
      let target = id ? current.find((region) => region.id === id) : null;
      if (!target && current[index]) target = current[index];

      if (!target) {
        const created = sanitizeRegion(item, page, current.length);
        current.push(created);
        target = created;
      }

      if (typeof item.translatedText === 'string' || typeof item.translation === 'string' || typeof item.text === 'string') {
        target.translatedText = String(item.translatedText ?? item.translation ?? item.text ?? '');
      }
      if (!target.sourceText && typeof item.sourceText === 'string') target.sourceText = item.sourceText;
      if (REGION_TYPES.includes(item.type)) target.type = item.type;

      const incomingBounds = item.bounds || item.box;
      if (incomingBounds && typeof incomingBounds === 'object') {
        target.bounds = {
          x: clampPercent(incomingBounds.x, target.bounds.x),
          y: clampPercent(incomingBounds.y, target.bounds.y),
          width: clampPercent(incomingBounds.width ?? incomingBounds.w, target.bounds.width),
          height: clampPercent(incomingBounds.height ?? incomingBounds.h, target.bounds.height),
        };
      }
      changed += 1;
    });
  }

  if (!rows.length && Array.isArray(payload?.translations)) {
    for (const row of payload.translations) {
      const page = Number(row?.page ?? row?.index);
      const text = row?.text ?? row?.translation ?? row?.translatedText;
      if (!Number.isInteger(page) || typeof text !== 'string') continue;
      const current = getPageRegions(page);
      if (!current.length) continue;
      current[0].translatedText = text;
      changed += 1;
    }
  }

  if (!changed) throw new Error('Nenhuma tradução/região compatível encontrada.');
  return changed;
}

const baseRenderPageRegions = renderPageRegions;
renderPageRegions = function renderPageRegionsWithTyper(page) {
  baseRenderPageRegions(page);
  ensureTyperToolbar();
  decorateTyperControls(page);
  renderTyperLayer(page);
};

importTranslation = async function importTranslationMerged(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const changed = mergeTranslationPayload(payload);
    writeTyperPrefs();
    persistDraft();
    renderAllRegions();
    setStatus(`${changed} região(ões) atualizada(s) sem perder posições do OCR.`, 'ok');
  } catch (error) {
    setStatus(`Falha ao importar: ${error.message}`, 'error');
  } finally {
    els.translationFile.value = '';
  }
};

ensureTyperToolbar();

window.mangaBridgeTyper = {
  renderPage: renderTyperLayer,
  autoStyle: defaultTyperStyle,
  showPreview(value = true) {
    typerUiState.preview = Boolean(value);
    syncTyperButtons();
  },
  showBoxes(value = true) {
    typerUiState.boxes = Boolean(value);
    syncTyperButtons();
  },
};
