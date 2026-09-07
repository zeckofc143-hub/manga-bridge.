(function(){
  'use strict';
  const T=window.DeseraTranslator;
  const input=document.getElementById('input');
  const result=document.getElementById('result');
  const count=document.getElementById('count');
  const translateBtn=document.getElementById('translate');
  const clearBtn=document.getElementById('clear');
  const copyBtn=document.getElementById('copy');
  const swapBtn=document.getElementById('swap');
  const fromLabel=document.getElementById('fromLabel');
  const toLabel=document.getElementById('toLabel');
  const directionText=document.getElementById('directionText');
  const info=document.getElementById('info');

  const WORD_HISTORY='desera.words.v9';
  const PHRASE_HISTORY='desera.phrases.v9';
  let mode='pt-desera';

  function readStore(key){
    try{
      const value=JSON.parse(localStorage.getItem(key)||'{}');
      return value&&typeof value==='object'?value:{};
    }catch{return {};}
  }

  function writeStore(key,value){
    try{localStorage.setItem(key,JSON.stringify(value));}catch{}
  }

  function remember(source,out){
    if(!source.trim()||!out.output) return;
    const words=readStore(WORD_HISTORY);
    const phrases=readStore(PHRASE_HISTORY);
    phrases[T.normalize(out.output)]=source.trim();
    for(const item of out.items||[]){
      if(!item.input||!item.output) continue;
      const key=T.normalizeDesera(item.output);
      if(!key) continue;
      const current=Array.isArray(words[key])?words[key]:[];
      if(!current.includes(item.input)) current.unshift(item.input);
      words[key]=current.slice(0,6);
    }
    writeStore(WORD_HISTORY,words);
    writeStore(PHRASE_HISTORY,phrases);
  }

  function render(){
    count.textContent=String(input.value.length);
    if(!input.value.trim()){
      result.textContent='A tradução aparece aqui.';
      result.classList.add('empty');
      info.textContent='';
      return;
    }

    if(mode==='pt-desera'){
      const out=T.translate(input.value);
      result.textContent=out.output||'—';
      result.classList.remove('empty');
      remember(input.value,out);
      info.textContent=out.direct&&out.status==='canon'
        ? 'Palavra canônica da língua.'
        : out.direct&&out.status==='defined'
          ? 'Forma definida no projeto.'
          : 'Tradução automática reversível em ABC normal.';
    }else{
      const out=T.reverse(input.value,readStore(WORD_HISTORY),readStore(PHRASE_HISTORY));
      result.textContent=out.output||'—';
      result.classList.remove('empty');
      info.textContent=out.unknown&&out.unknown.length
        ? `Não reconhecido: ${out.unknown.join(', ')}`
        : 'Tradução reversa concluída.';
    }
  }

  function swap(moveOutput){
    const oldOutput=!result.classList.contains('empty')?result.textContent:'';
    mode=mode==='pt-desera'?'desera-pt':'pt-desera';

    if(mode==='pt-desera'){
      fromLabel.textContent='Português';
      toLabel.textContent='Desera — ABC normal';
      directionText.textContent='Português → Desera';
      input.placeholder='Ex.: destino';
    }else{
      fromLabel.textContent='Desera — ABC normal';
      toLabel.textContent='Português';
      directionText.textContent='Desera → Português';
      input.placeholder='Ex.: weran';
    }

    if(moveOutput&&oldOutput) input.value=oldOutput;
    render();
    input.focus();
  }

  input.addEventListener('input',render);
  translateBtn.addEventListener('click',render);
  clearBtn.addEventListener('click',()=>{input.value='';render();input.focus();});
  swapBtn.addEventListener('click',()=>swap(true));
  copyBtn.addEventListener('click',async()=>{
    if(result.classList.contains('empty')) return;
    try{
      await navigator.clipboard.writeText(result.textContent||'');
      copyBtn.textContent='Copiado';
    }catch{
      copyBtn.textContent='Selecione';
    }
    setTimeout(()=>copyBtn.textContent='Copiar',900);
  });

  document.querySelectorAll('[data-word]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(mode!=='pt-desera') swap(false);
      input.value=btn.dataset.word||'';
      render();
      input.focus();
    });
  });

  render();
})();
