const officialDictionary = [
  { pt: 'destino', aliases: ['fado','destino cósmico','destino cosmico'], abc: 'weran', roman: 'wëran', ipa: '/wəɾan/', status: 'current', note: 'Forma atual usada para o Conceito/termo de Destino.' },
  { pt: 'presença', aliases: ['presenca'], abc: 'korun', roman: 'korun', ipa: '/koɾun/', status: 'canon' },
  { pt: 'presença mental', aliases: ['presenca mental'], abc: 'korevi', roman: 'korevi', ipa: '/koɾevi/', status: 'canon' },
  { pt: 'atenção', aliases: ['atencao'], abc: 'tishen', roman: 'tishen', ipa: '/tiʃen/', status: 'canon' },
  { pt: 'despertar', aliases: [], abc: 'karen', roman: 'karen', ipa: '/kaɾen/', status: 'canon' },
  { pt: 'consciência', aliases: ['consciencia'], abc: 'leseri', roman: 'leseri', ipa: '/leseɾi/', status: 'canon' },
  { pt: 'memória', aliases: ['memoria'], abc: 'neran', roman: 'neran', ipa: '/neɾan/', status: 'canon' },
  { pt: 'querer', aliases: ['desejar'], abc: 'vera', roman: 'vera', ipa: '/veɾa/', status: 'canon' },
  { pt: 'vontade', aliases: [], abc: 'uran', roman: 'uran', ipa: '/uɾan/', status: 'canon' },
  { pt: 'permanecer', aliases: ['continuar'], abc: 'saren', roman: 'saren', ipa: '/saɾen/', status: 'canon' },
  { pt: 'identidade', aliases: [], abc: 'serang', roman: 'serang', ipa: '/seɾaŋ/', status: 'canon' }
];

const $ = (id) => document.getElementById(id);
const sourceInput = $('sourceInput');
const translateBtn = $('translateBtn');
const swapBtn = $('swapBtn');
const sourceLabel = $('sourceLabel');
const result = $('result');
const notFound = $('notFound');
const resultStatus = $('resultStatus');
const resultWord = $('resultWord');
const resultRoman = $('resultRoman');
const resultIpa = $('resultIpa');
const resultMeaning = $('resultMeaning');
const resultNote = $('resultNote');
const copyBtn = $('copyBtn');
const dictionaryList = $('dictionaryList');
const dictionarySearch = $('dictionarySearch');
const wordCount = $('wordCount');
const saveCustomBtn = $('saveCustomBtn');
const customPt = $('customPt');
const customAbc = $('customAbc');
const customIpa = $('customIpa');

let reverseMode = false;
let lastResult = '';

function normalize(value){
  return (value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/\s+/g,' ');
}

function loadCustom(){
  try { return JSON.parse(localStorage.getItem('desera-custom-dictionary') || '[]'); }
  catch { return []; }
}

function saveCustom(items){
  localStorage.setItem('desera-custom-dictionary', JSON.stringify(items));
}

function allEntries(){
  return [...officialDictionary, ...loadCustom()];
}

function findEntry(query){
  const q = normalize(query);
  if (!q) return null;
  return allEntries().find(entry => {
    if (reverseMode) {
      return normalize(entry.abc) === q || normalize(entry.roman) === q;
    }
    return normalize(entry.pt) === q || (entry.aliases || []).some(a => normalize(a) === q);
  }) || null;
}

function showEntry(entry){
  notFound.classList.add('hidden');
  result.classList.remove('hidden');
  resultWord.textContent = reverseMode ? entry.pt : entry.abc;
  resultRoman.textContent = entry.roman || entry.abc;
  resultIpa.textContent = entry.ipa || '—';
  resultMeaning.textContent = entry.pt;
  resultNote.textContent = entry.note || '';
  lastResult = reverseMode ? entry.pt : entry.abc;

  const isDraft = entry.status === 'draft';
  resultStatus.textContent = isDraft ? 'RASCUNHO LOCAL' : (entry.status === 'current' ? 'FORMA ATUAL' : 'CANÔNICO');
  resultStatus.classList.toggle('draft', isDraft || entry.status === 'current');
}

function translate(){
  const entry = findEntry(sourceInput.value);
  if (!entry){
    result.classList.add('hidden');
    notFound.classList.remove('hidden');
    return;
  }
  showEntry(entry);
}

function renderDictionary(filter=''){
  const q = normalize(filter);
  const entries = allEntries()
    .filter(e => !q || normalize(e.pt).includes(q) || normalize(e.abc).includes(q) || normalize(e.roman).includes(q))
    .sort((a,b) => a.pt.localeCompare(b.pt, 'pt-BR'));

  wordCount.textContent = `${entries.length} termo${entries.length === 1 ? '' : 's'}`;
  dictionaryList.innerHTML = '';

  entries.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'dict-item';
    item.tabIndex = 0;
    item.role = 'button';
    item.innerHTML = `
      <div class="dict-pt">${escapeHtml(entry.pt)}</div>
      <div class="dict-abc">${escapeHtml(entry.abc)}</div>
      <div class="dict-ipa">${escapeHtml(entry.ipa || '')}</div>
    `;
    item.addEventListener('click', () => {
      reverseMode = false;
      syncMode();
      sourceInput.value = entry.pt;
      showEntry(entry);
      window.scrollTo({top:0, behavior:'smooth'});
    });
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') item.click();
    });
    dictionaryList.appendChild(item);
  });
}

function escapeHtml(value){
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function syncMode(){
  sourceLabel.textContent = reverseMode ? 'ABC / romanização' : 'Português';
  sourceInput.placeholder = reverseMode ? 'Ex.: weran' : 'Ex.: destino';
  result.classList.add('hidden');
  notFound.classList.add('hidden');
}

translateBtn.addEventListener('click', translate);
sourceInput.addEventListener('keydown', e => { if (e.key === 'Enter') translate(); });
sourceInput.addEventListener('input', () => {
  if (sourceInput.value.trim().length >= 2) {
    const entry = findEntry(sourceInput.value);
    if (entry) showEntry(entry);
  }
});

swapBtn.addEventListener('click', () => {
  reverseMode = !reverseMode;
  sourceInput.value = '';
  syncMode();
  sourceInput.focus();
});

copyBtn.addEventListener('click', async () => {
  if (!lastResult) return;
  try {
    await navigator.clipboard.writeText(lastResult);
    copyBtn.textContent = 'Copiado';
    setTimeout(() => copyBtn.textContent = 'Copiar', 1200);
  } catch {
    copyBtn.textContent = 'Selecione';
  }
});

dictionarySearch.addEventListener('input', () => renderDictionary(dictionarySearch.value));

saveCustomBtn.addEventListener('click', () => {
  const pt = customPt.value.trim();
  const abc = customAbc.value.trim().toLowerCase();
  const ipa = customIpa.value.trim();
  if (!pt || !abc) return;

  const custom = loadCustom();
  const next = custom.filter(e => normalize(e.pt) !== normalize(pt));
  next.push({ pt, aliases: [], abc, roman: abc, ipa, status: 'draft', note: 'Rascunho salvo localmente neste aparelho.' });
  saveCustom(next);
  customPt.value = '';
  customAbc.value = '';
  customIpa.value = '';
  renderDictionary(dictionarySearch.value);
  sourceInput.value = pt;
  reverseMode = false;
  syncMode();
  sourceInput.value = pt;
  translate();
});

renderDictionary();
