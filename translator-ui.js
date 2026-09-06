(function(){
  'use strict';
  const T=window.DeseraTranslator;
  const input=document.getElementById('input');
  const result=document.getElementById('result');
  const status=document.getElementById('status');
  const badge=document.getElementById('badge');
  const details=document.getElementById('details');
  const count=document.getElementById('count');
  const translateBtn=document.getElementById('translate');
  const clearBtn=document.getElementById('clear');
  const copyBtn=document.getElementById('copy');
  const swapBtn=document.getElementById('swap');
  const fromLabel=document.getElementById('fromLabel');
  const toLabel=document.getElementById('toLabel');
  const directionText=document.getElementById('directionText');

  const HISTORY_KEY='desera.reverse.words.v8';
  const PHRASE_KEY='desera.reverse.phrases.v8';
  const WORDLIST_URLS=[
    'https://raw.githubusercontent.com/pythonprobr/palavras/master/palavras.txt',
    'https://cdn.jsdelivr.net/gh/pythonprobr/palavras@master/palavras.txt'
  ];

  let mode='pt-desera';
  let wordlistPromise=null;
  let busy=false;

  function readStore(key){
    try{
      const value=JSON.parse(localStorage.getItem(key)||'{}');
      return value&&typeof value==='object'?value:{};
    }catch{return {};}
  }

  function writeStore(key,value){
    try{localStorage.setItem(key,JSON.stringify(value));}catch{}
  }

  function setBadge(text,kind){
    badge.textContent=text;
    badge.className='badge '+kind;
  }

  function setBusy(value){
    busy=value;
    translateBtn.disabled=value;
    swapBtn.disabled=value;
    translateBtn.textContent=value?'Procurando…':'Traduzir';
  }

  function rememberForward(source,out){
    const wordIndex=readStore(HISTORY_KEY);
    const phraseIndex=readStore(PHRASE_KEY);

    if(out.output&&String(source||'').trim()){
      phraseIndex[T.normalize(out.output)]=String(source).trim();
    }

    for(const item of out.items||[]){
      if(!item.output||!item.input||item.kind==='article') continue;
      const key=T.normalizeDesera(item.output);
      const pt=T.normalize(item.input);
      if(!key||!pt) continue;
      const list=Array.isArray(wordIndex[key])?wordIndex[key]:[];
      if(!list.includes(pt)) list.unshift(pt);
      wordIndex[key]=list.slice(0,12);
    }

    writeStore(HISTORY_KEY,wordIndex);
    writeStore(PHRASE_KEY,phraseIndex);
  }

  function mergeAndSaveReverse(extra){
    const current=readStore(HISTORY_KEY);
    const merged=T.mergeReverseIndexes(current,extra);
    writeStore(HISTORY_KEY,merged);
    return merged;
  }

  async function loadWordlist(){
    if(wordlistPromise) return wordlistPromise;
    wordlistPromise=(async()=>{
      let lastError=null;
      for(const url of WORDLIST_URLS){
        try{
          const response=await fetch(url,{cache:'force-cache'});
          if(!response.ok) throw new Error(`HTTP ${response.status}`);
          const text=await response.text();
          if(text.length<100000) throw new Error('lista incompleta');
          return text.split(/\r?\n/);
        }catch(error){lastError=error;}
      }
      throw lastError||new Error('Não foi possível carregar a lista PT-BR.');
    })();
    return wordlistPromise;
  }

  async function searchUnknownWords(targets){
    const wanted=[...new Set((targets||[]).map(T.normalizeDesera).filter(Boolean))];
    if(!wanted.length) return {};

    setBusy(true);
    setBadge('BUSCANDO','proposal');
    status.textContent='Procurando o significado reverso no vocabulário PT-BR…';
    details.textContent='Isso só acontece para palavras antigas que ainda não estavam salvas no aparelho.';

    try{
      const words=await loadWordlist();
      let found={};
      const chunkSize=10000;

      for(let i=0;i<words.length;i+=chunkSize){
        const chunk=words.slice(i,i+chunkSize);
        found=T.mergeReverseIndexes(found,T.findReverseMatches(chunk,wanted,12));

        const resolved=wanted.filter(key=>Array.isArray(found[key])&&found[key].length>0).length;
        const percent=Math.min(100,Math.round(((i+chunk.length)/words.length)*100));
        status.textContent=`Lendo vocabulário PT-BR… ${percent}% · ${resolved}/${wanted.length} encontrados`;

        if(resolved===wanted.length) break;
        if(i%30000===0) await new Promise(resolve=>setTimeout(resolve,0));
      }

      return found;
    }finally{
      setBusy(false);
    }
  }

  function renderForward(){
    const value=input.value;
    const out=T.translate(value);
    result.textContent=out.output||'A tradução aparece aqui.';
    result.classList.toggle('empty',!out.output);

    if(!out.output){
      setBadge('PRONTO','neutral');
      status.textContent='Escreve uma palavra, conceito, nome ou frase.';
      details.textContent='';
      return;
    }

    rememberForward(value,out);

    if(out.direct&&(out.status==='canon'||out.status==='defined')){
      setBadge(out.status==='canon'?'LÉXICO':'DEFINIDO',out.status==='canon'?'canon':'defined');
      status.textContent='Forma já definida na língua.';
      const item=out.items[0];
      details.textContent=item.roman&&item.roman!==item.output?`Forma fonológica: ${item.roman}`:'';
      return;
    }

    if(out.status==='generated-word'){
      setBadge('FORMADA','proposal');
      status.textContent='Palavra formada pelo motor da língua e salva para tradução reversa.';
      details.textContent='Se você inverter a direção depois, ela volta para o português.';
      return;
    }

    setBadge('FRASE','proposal');
    status.textContent='Frase traduzida com léxico existente + formação das palavras que faltavam.';
    details.textContent='Esta tradução também foi salva localmente para poder ser revertida.';
  }

  function renderReverseResult(out){
    result.textContent=out.output||'A tradução aparece aqui.';
    result.classList.toggle('empty',!out.output);

    if(out.status==='history-exact'){
      setBadge('EXATO','canon');
      status.textContent='Frase recuperada exatamente da tradução feita neste aparelho.';
      details.textContent='';
      return;
    }

    if(out.unknown&&out.unknown.length){
      setBadge('INCOMPLETO','proposal');
      status.textContent=`Ainda faltam ${out.unknown.length} palavra(s). Toque em Traduzir para pesquisar no vocabulário.`;
      details.textContent=out.unknown.join(', ');
      return;
    }

    if(out.ambiguous&&out.ambiguous.length){
      setBadge('AMBÍGUO','proposal');
      status.textContent='Tradução encontrada, mas algumas formas correspondem a mais de uma palavra portuguesa.';
      details.textContent=out.ambiguous.map(item=>`${item.input}: ${item.candidates.join(' / ')}`).join(' · ');
      return;
    }

    setBadge('TRADUZIDO','canon');
    status.textContent='Tradução reversa concluída.';
    details.textContent='';
  }

  async function renderReverse(searchRemote){
    const value=input.value;
    if(!value.trim()){
      result.textContent='A tradução aparece aqui.';
      result.classList.add('empty');
      setBadge('PRONTO','neutral');
      status.textContent='Cole uma palavra ou frase da língua de Desera.';
      details.textContent='';
      return;
    }

    let index=readStore(HISTORY_KEY);
    const phraseIndex=readStore(PHRASE_KEY);
    let out=T.reverse(value,index,phraseIndex);
    renderReverseResult(out);

    if(searchRemote&&out.unknown&&out.unknown.length){
      try{
        const found=await searchUnknownWords(out.unknown);
        index=mergeAndSaveReverse(found);
        out=T.reverse(value,index,phraseIndex);
        renderReverseResult(out);
      }catch(error){
        setBadge('SEM REDE','proposal');
        status.textContent='Não consegui carregar o vocabulário externo agora. A tradução salva no aparelho continua funcionando.';
        details.textContent=String(error&&error.message?error.message:error);
      }
    }
  }

  async function render(searchRemote){
    if(busy) return;
    count.textContent=String(input.value.length);
    if(mode==='pt-desera') renderForward();
    else await renderReverse(Boolean(searchRemote));
  }

  function updateDirection(moveOutput){
    const oldOutput=!result.classList.contains('empty')?result.textContent:'';
    mode=mode==='pt-desera'?'desera-pt':'pt-desera';

    if(mode==='pt-desera'){
      fromLabel.textContent='Português';
      toLabel.textContent='Língua de Desera — ABC normal';
      directionText.textContent='Português → Desera';
      input.placeholder='Ex.: destino';
    }else{
      fromLabel.textContent='Língua de Desera — ABC normal';
      toLabel.textContent='Português';
      directionText.textContent='Desera → Português';
      input.placeholder='Ex.: weran';
    }

    if(moveOutput&&oldOutput){
      input.value=oldOutput;
      count.textContent=String(input.value.length);
    }
    render(false);
  }

  translateBtn.addEventListener('click',()=>render(true));
  input.addEventListener('input',()=>render(false));
  input.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='Enter') render(true);
  });
  clearBtn.addEventListener('click',()=>{input.value='';render(false);input.focus();});
  swapBtn.addEventListener('click',()=>updateDirection(true));

  copyBtn.addEventListener('click',async()=>{
    if(result.classList.contains('empty')) return;
    try{
      await navigator.clipboard.writeText(result.textContent||'');
      copyBtn.textContent='Copiado';
      setTimeout(()=>copyBtn.textContent='Copiar',1000);
    }catch{
      copyBtn.textContent='Selecione';
      setTimeout(()=>copyBtn.textContent='Copiar',1000);
    }
  });

  document.querySelectorAll('[data-word]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(mode!=='pt-desera') updateDirection(false);
      input.value=btn.dataset.word||'';
      render(false);
      input.focus();
    });
  });

  updateDirection(false);
  updateDirection(false);
})();
