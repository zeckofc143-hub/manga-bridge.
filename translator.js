const dictionary = [
  { pt: 'presença mental', abc: 'korevi' },
  { pt: 'presenca mental', abc: 'korevi' },
  { pt: 'destino', abc: 'weran' },
  { pt: 'fado', abc: 'weran' },
  { pt: 'presença', abc: 'korun' },
  { pt: 'presenca', abc: 'korun' },
  { pt: 'atenção', abc: 'tishen' },
  { pt: 'atencao', abc: 'tishen' },
  { pt: 'despertar', abc: 'karen' },
  { pt: 'consciência', abc: 'leseri' },
  { pt: 'consciencia', abc: 'leseri' },
  { pt: 'memória', abc: 'neran' },
  { pt: 'memoria', abc: 'neran' },
  { pt: 'querer', abc: 'vera' },
  { pt: 'desejar', abc: 'vera' },
  { pt: 'vontade', abc: 'uran' },
  { pt: 'permanecer', abc: 'saren' },
  { pt: 'continuar', abc: 'saren' },
  { pt: 'identidade', abc: 'serang' }
];

const sourceInput = document.getElementById('sourceInput');
const resultOutput = document.getElementById('resultOutput');
const status = document.getElementById('status');
const copyBtn = document.getElementById('copyBtn');

function normalize(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const entries = dictionary
  .map(item => ({ ...item, normalized: normalize(item.pt) }))
  .sort((a, b) => b.normalized.length - a.normalized.length);

function translateText(text) {
  const original = text.trim();
  if (!original) return { text: '', unknown: [] };

  let normalized = normalize(original);
  const direct = entries.find(entry => entry.normalized === normalized);
  if (direct) return { text: direct.abc, unknown: [] };

  const words = original.split(/(\s+|[,.!?;:()\-]+)/);
  const unknown = new Set();
  const translated = words.map(part => {
    if (!part || /^\s+$/.test(part) || /^[,.!?;:()\-]+$/.test(part)) return part;
    const key = normalize(part);
    const entry = entries.find(item => item.normalized === key);
    if (entry) return entry.abc;
    unknown.add(part);
    return part;
  }).join('');

  return { text: translated, unknown: [...unknown] };
}

function updateTranslation() {
  const value = sourceInput.value;
  const translated = translateText(value);
  resultOutput.value = translated.text;

  if (!value.trim()) {
    status.textContent = 'Digite algo para traduzir.';
    status.className = 'status';
  } else if (translated.unknown.length === 0) {
    status.textContent = 'Traduzido.';
    status.className = 'status ok';
  } else {
    status.textContent = `Ainda não temos tradução para: ${translated.unknown.join(', ')}`;
    status.className = 'status warn';
  }
}

sourceInput.addEventListener('input', updateTranslation);

copyBtn.addEventListener('click', async () => {
  if (!resultOutput.value) return;
  try {
    await navigator.clipboard.writeText(resultOutput.value);
    copyBtn.textContent = 'Copiado';
    setTimeout(() => copyBtn.textContent = 'Copiar', 1200);
  } catch {
    resultOutput.select();
    copyBtn.textContent = 'Selecionado';
    setTimeout(() => copyBtn.textContent = 'Copiar', 1200);
  }
});

updateTranslation();
