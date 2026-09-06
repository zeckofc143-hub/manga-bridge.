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

  function setBadge(text,kind){
    badge.textContent=text;
    badge.className='badge '+kind;
  }

  function render(){
    const value=input.value;
    count.textContent=String(value.length);
    if(!value.trim()){
      result.textContent='A tradução aparece aqui.';
      result.classList.add('empty');
      setBadge('PRONTO','neutral');
      status.textContent='Palavra já criada → tradução real. Palavra nova → adaptação sonora marcada como proposta. Nada é fingido como cânone.';
      details.textContent='';
      return;
    }

    const out=T.translate(value);
    result.textContent=out.output||'—';
    result.classList.remove('empty');

    if(out.direct&&out.status==='canon'){
      setBadge('CANÔNICO','canon');
      status.textContent='Tradução registrada no léxico da língua.';
      const item=out.items[0];
      details.textContent=item.roman&&item.roman!==item.output?`Romanização técnica: ${item.roman}`:'';
      return;
    }

    if(out.direct&&out.status==='session'){
      setBadge('DEFINIDO','defined');
      status.textContent='Forma definida para este conceito no projeto atual.';
      const item=out.items[0];
      details.textContent=item.roman&&item.roman!==item.output?`Forma fonológica: ${item.roman}`:'';
      return;
    }

    if(out.status==='lexical-only'){
      setBadge('LÉXICO','defined');
      status.textContent='Todas as palavras reconhecidas existem no léxico, mas a frase completa não é certificada como gramatical sem morfemas/estrutura final.';
      details.textContent='';
      return;
    }

    setBadge('PROPOSTA','proposal');
    const proposed=(out.items||[]).filter(x=>x.kind==='phonetic-adaptation').map(x=>x.input);
    status.textContent=proposed.length===1
      ? `“${proposed[0]}” ainda não possui palavra lexical definida. A saída é uma adaptação sonora válida para rascunho, não uma tradução canônica.`
      : `${proposed.length} partes ainda não possuem forma lexical definida. A saída abaixo é rascunho palavra por palavra, não uma frase canônica.`;
    details.textContent=out.warning||'';
  }

  translateBtn.addEventListener('click',render);
  input.addEventListener('input',render);
  input.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='Enter') render();
  });
  clearBtn.addEventListener('click',()=>{input.value='';render();input.focus();});
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
    btn.addEventListener('click',()=>{input.value=btn.dataset.word||'';render();input.focus();});
  });

  render();
})();
