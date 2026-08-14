const redrawUiState = {
  preview: false,
  masks: false,
};

const REDRAW_MODES = ['off', 'auto', 'white', 'dark', 'blur', 'clone-up', 'clone-down', 'clone-left', 'clone-right'];

function redrawClamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function defaultRedrawStyle(type = 'other') {
  if (type === 'dialogue' || type === 'thought') {
    return { mode: 'white', padding: 0.7, shift: 2.2, blur: 0.6, opacity: 100, radius: 10 };
  }
  if (type === 'narration') {
    return { mode: 'dark', padding: 0.7, shift: 2.2, blur: 0.6, opacity: 100, radius: 6 };
  }
  if (type === 'sfx' || type === 'sign') {
    return { mode: 'clone-up', padding: 0.6, shift: 2.8, blur: 0.8, opacity: 100, radius: 8 };
  }
  return { mode: 'clone-up', padding: 0.5, shift: 2.2, blur: 0.8, opacity: 100, radius: 8 };
}

function normalizeRedrawStyle(value, type) {
  const base = defaultRedrawStyle(type);
  const style = value && typeof value === 'object' ? value : {};
  return {
    mode: REDRAW_MODES.includes(style.mode) ? style.mode : base.mode,
    padding: redrawClamp(style.padding, 0, 8, base.padding),
    shift: redrawClamp(style.shift, 0, 15, base.shift),
    blur: redrawClamp(style.blur, 0, 8, base.blur),
    opacity: redrawClamp(style.opacity, 0, 100, base.opacity),
    radius: redrawClamp(style.radius, 0, 40, base.radius),
  };
}

function redrawStorageKey() {
  return state.chapter ? `mangaBridgeRedraw:${state.chapter.chapterId}` : null;
}

function readRedrawPrefs() {
  const key = redrawStorageKey();
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function writeRedrawPrefs() {
  const key = redrawStorageKey();
  if (!key) return;
  const data = {};
  for (const regions of state.regions.values()) {
    for (const region of regions || []) {
      if (region?.id && region?.redraw) data[region.id] = normalizeRedrawStyle(region.redraw, region.type);
    }
  }
  localStorage.setItem(key, JSON.stringify(data));
}

function ensureRedraw(region) {
  if (!region) return defaultRedrawStyle('other');
  if (!region.redraw) {
    const saved = readRedrawPrefs()[region.id];
    region.redraw = normalizeRedrawStyle(saved, region.type);
  } else {
    region.redraw = normalizeRedrawStyle(region.redraw, region.type);
  }
  return region.redraw;
}

function resolvedRedrawMode(style, type) {
  if (style.mode !== 'auto') return style.mode;
  return defaultRedrawStyle(type).mode;
}

function expandedBounds(bounds, padding) {
  const pad = redrawClamp(padding, 0, 8, 0);
  const x = Math.max(0, Number(bounds.x || 0) - pad);
  const y = Math.max(0, Number(bounds.y || 0) - pad);
  const right = Math.min(100, Number(bounds.x || 0) + Number(bounds.width || 0) + pad);
  const bottom = Math.min(100, Number(bounds.y || 0) + Number(bounds.height || 0) + pad);
  return {
    x,
    y,
    width: Math.max(0.1, right - x),
    height: Math.max(0.1, bottom - y),
  };
}

function ensureRedrawLayer(card) {
  const wrap = card?.querySelector('.image-wrap');
  if (!wrap) return null;
  let layer = wrap.querySelector('.redraw-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'redraw-layer';
    const translation = wrap.querySelector('.translation-layer');
    if (translation) wrap.insertBefore(layer, translation);
    else wrap.appendChild(layer);
  }
  return layer;
}

function setCloneImageGeometry(img, bounds, style, mode) {
  const w = Math.max(0.1, bounds.width);
  const h = Math.max(0.1, bounds.height);
  let left = -(bounds.x * 100 / w);
  let top = -(bounds.y * 100 / h);
  const sx = style.shift * 100 / w;
  const sy = style.shift * 100 / h;

  if (mode === 'clone-up') top += sy;
  else if (mode === 'clone-down') top -= sy;
  else if (mode === 'clone-left') left += sx;
  else if (mode === 'clone-right') left -= sx;

  img.style.width = `${10000 / w}%`;
  img.style.height = `${10000 / h}%`;
  img.style.left = `${left}%`;
  img.style.top = `${top}%`;
  img.style.filter = style.blur ? `blur(${style.blur}px)` : 'none';
}

function buildRedrawPatch(card, region, index) {
  const style = ensureRedraw(region);
  const mode = resolvedRedrawMode(style, region.type);
  if (mode === 'off') return null;

  const bounds = expandedBounds(region.bounds, style.padding);
  const patch = document.createElement('div');
  patch.className = `redraw-patch redraw-${mode}`;
  patch.dataset.regionId = region.id;
  patch.style.left = `${bounds.x}%`;
  patch.style.top = `${bounds.y}%`;
  patch.style.width = `${bounds.width}%`;
  patch.style.height = `${bounds.height}%`;
  patch.style.opacity = String(style.opacity / 100);
  patch.style.borderRadius = `${style.radius}px`;
  patch.style.setProperty('--redraw-blur', `${style.blur}px`);

  if (mode.startsWith('clone-')) {
    const source = card.querySelector('.page-image');
    const img = document.createElement('img');
    img.className = 'redraw-clone-image';
    img.src = source?.currentSrc || source?.src || '';
    img.alt = '';
    img.draggable = false;
    setCloneImageGeometry(img, bounds, style, mode);
    patch.appendChild(img);
  } else if (mode === 'blur') {
    patch.style.backdropFilter = `blur(${Math.max(1, style.blur)}px)`;
    patch.style.webkitBackdropFilter = `blur(${Math.max(1, style.blur)}px)`;
  }

  if (redrawUiState.masks) {
    const badge = document.createElement('span');
    badge.className = 'redraw-mask-number';
    badge.textContent = String(index + 1);
    patch.appendChild(badge);
  }

  return patch;
}

function renderRedrawLayer(page) {
  const card = document.querySelector(`.page-card[data-page="${page}"]`);
  if (!card) return;
  const layer = ensureRedrawLayer(card);
  if (!layer) return;
  layer.innerHTML = '';

  getPageRegions(page).forEach((region, index) => {
    const patch = buildRedrawPatch(card, region, index);
    if (patch) layer.appendChild(patch);
  });

  layer.classList.toggle('hidden', !redrawUiState.preview);
  layer.classList.toggle('show-masks', redrawUiState.masks);
}

function syncRedrawButtons() {
  const previewBtn = document.querySelector('#toggleRedrawPreviewBtn');
  const masksBtn = document.querySelector('#toggleRedrawMasksBtn');
  if (previewBtn) previewBtn.textContent = `Redraw: ${redrawUiState.preview ? 'ON' : 'OFF'}`;
  if (masksBtn) masksBtn.textContent = `Máscaras redraw: ${redrawUiState.masks ? 'ON' : 'OFF'}`;
  document.querySelectorAll('.redraw-layer').forEach((layer) => {
    layer.classList.toggle('hidden', !redrawUiState.preview);
    layer.classList.toggle('show-masks', redrawUiState.masks);
  });
}

function ensureRedrawToolbar() {
  const tools = document.querySelector('.translation-tools');
  if (!tools || document.querySelector('#toggleRedrawPreviewBtn')) return;

  const preview = document.createElement('button');
  preview.id = 'toggleRedrawPreviewBtn';
  preview.className = 'ghost';
  preview.type = 'button';
  preview.addEventListener('click', () => {
    redrawUiState.preview = !redrawUiState.preview;
    renderAllRegions();
    syncRedrawButtons();
  });

  const masks = document.createElement('button');
  masks.id = 'toggleRedrawMasksBtn';
  masks.className = 'ghost';
  masks.type = 'button';
  masks.addEventListener('click', () => {
    redrawUiState.masks = !redrawUiState.masks;
    renderAllRegions();
    syncRedrawButtons();
  });

  const auto = document.createElement('button');
  auto.id = 'autoRedrawBtn';
  auto.className = 'ghost';
  auto.type = 'button';
  auto.textContent = 'Auto redraw';
  auto.addEventListener('click', () => {
    let changed = 0;
    for (const regions of state.regions.values()) {
      for (const region of regions || []) {
        region.redraw = defaultRedrawStyle(region.type);
        changed += 1;
      }
    }
    redrawUiState.preview = true;
    writeRedrawPrefs();
    persistDraft();
    renderAllRegions();
    syncRedrawButtons();
    setStatus(`Redraw automático preparado em ${changed} regiões. Ajuste direção/shift onde a arte pedir.`, 'ok');
  });

  tools.append(preview, masks, auto);
  syncRedrawButtons();
}

function decorateRedrawControls(page) {
  const card = document.querySelector(`.page-card[data-page="${page}"]`);
  if (!card) return;
  const regions = getPageRegions(page);
  const cards = card.querySelectorAll('.region-card');

  cards.forEach((regionCard, index) => {
    const region = regions[index];
    if (!region || regionCard.querySelector('.redraw-panel')) return;
    const style = ensureRedraw(region);

    const panel = document.createElement('div');
    panel.className = 'redraw-panel';
    panel.innerHTML = `
      <div class="redraw-head">
        <strong>Redraw</strong>
        <span class="tiny muted">limpeza visual do texto original</span>
      </div>
      <div class="redraw-grid">
        <div class="field half"><label>Modo</label><select data-redraw="mode">
          <option value="off"${style.mode === 'off' ? ' selected' : ''}>desligado</option>
          <option value="auto"${style.mode === 'auto' ? ' selected' : ''}>automático</option>
          <option value="white"${style.mode === 'white' ? ' selected' : ''}>preencher branco</option>
          <option value="dark"${style.mode === 'dark' ? ' selected' : ''}>preencher escuro</option>
          <option value="blur"${style.mode === 'blur' ? ' selected' : ''}>desfocar</option>
          <option value="clone-up"${style.mode === 'clone-up' ? ' selected' : ''}>clonar de cima</option>
          <option value="clone-down"${style.mode === 'clone-down' ? ' selected' : ''}>clonar de baixo</option>
          <option value="clone-left"${style.mode === 'clone-left' ? ' selected' : ''}>clonar da esquerda</option>
          <option value="clone-right"${style.mode === 'clone-right' ? ' selected' : ''}>clonar da direita</option>
        </select></div>
        <div class="field"><label>Margem %</label><input data-redraw="padding" type="number" min="0" max="8" step="0.1" value="${style.padding}" /></div>
        <div class="field"><label>Deslocamento %</label><input data-redraw="shift" type="number" min="0" max="15" step="0.1" value="${style.shift}" /></div>
        <div class="field"><label>Suavização px</label><input data-redraw="blur" type="number" min="0" max="8" step="0.1" value="${style.blur}" /></div>
        <div class="field"><label>Opacidade %</label><input data-redraw="opacity" type="number" min="0" max="100" step="1" value="${style.opacity}" /></div>
        <div class="field"><label>Cantos px</label><input data-redraw="radius" type="number" min="0" max="40" step="1" value="${style.radius}" /></div>
      </div>
      <div class="redraw-actions">
        <button class="ghost redraw-reset" type="button">Auto para este tipo</button>
        <button class="ghost redraw-off" type="button">Não limpar esta região</button>
      </div>`;

    panel.querySelectorAll('[data-redraw]').forEach((input) => {
      const update = () => {
        const key = input.dataset.redraw;
        if (key === 'mode') style[key] = input.value;
        else if (key === 'padding') style[key] = redrawClamp(input.value, 0, 8, style[key]);
        else if (key === 'shift') style[key] = redrawClamp(input.value, 0, 15, style[key]);
        else if (key === 'blur') style[key] = redrawClamp(input.value, 0, 8, style[key]);
        else if (key === 'opacity') style[key] = redrawClamp(input.value, 0, 100, style[key]);
        else if (key === 'radius') style[key] = redrawClamp(input.value, 0, 40, style[key]);
        region.redraw = normalizeRedrawStyle(style, region.type);
        redrawUiState.preview = true;
        writeRedrawPrefs();
        persistDraft();
        renderRedrawLayer(page);
        syncRedrawButtons();
      };
      input.addEventListener('input', update);
      input.addEventListener('change', update);
    });

    panel.querySelector('.redraw-reset').addEventListener('click', () => {
      region.redraw = defaultRedrawStyle(region.type);
      redrawUiState.preview = true;
      writeRedrawPrefs();
      persistDraft();
      renderPageRegions(page);
      syncRedrawButtons();
      setStatus(`Redraw automático restaurado em ${region.id}.`, 'ok');
    });

    panel.querySelector('.redraw-off').addEventListener('click', () => {
      region.redraw = { ...ensureRedraw(region), mode: 'off' };
      writeRedrawPrefs();
      persistDraft();
      renderPageRegions(page);
      setStatus(`Redraw desligado em ${region.id}.`, 'ok');
    });

    regionCard.querySelectorAll('[data-bound]').forEach((input) => {
      input.addEventListener('input', () => renderRedrawLayer(page));
    });

    const typeSelect = regionCard.querySelector('[data-field="type"]');
    typeSelect?.addEventListener('change', () => {
      region.redraw = normalizeRedrawStyle(region.redraw, region.type);
      writeRedrawPrefs();
      renderRedrawLayer(page);
    });

    regionCard.appendChild(panel);
  });
}

const redrawBaseRenderPageRegions = renderPageRegions;
renderPageRegions = function renderPageRegionsWithRedraw(page) {
  redrawBaseRenderPageRegions(page);
  ensureRedrawToolbar();
  decorateRedrawControls(page);
  renderRedrawLayer(page);
  syncRedrawButtons();
};

ensureRedrawToolbar();

window.mangaBridgeRedraw = {
  renderPage: renderRedrawLayer,
  autoStyle: defaultRedrawStyle,
  show(value = true) {
    redrawUiState.preview = Boolean(value);
    renderAllRegions();
    syncRedrawButtons();
  },
  showMasks(value = true) {
    redrawUiState.masks = Boolean(value);
    renderAllRegions();
    syncRedrawButtons();
  },
};
