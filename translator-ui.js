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
      status.textContent='Escreve uma palavra, conceito, nome ou frase.';
      details.textContent='';
      return;
    }

    const out=T.translate(value);
    result.textContent=out.output||'—';
    result.classList.remove('empty');

    if(out.direct&&out.status==='canon'){
      setBadge('LÉXICO','canon');
      status.textContent='Forma já definida na língua.';
      const item=out.items[0];
      details.textContent=item.roman&&item.roman!==item.output?`Forma fonológica: ${item.roman}`:'';
      return;
    }

    if(out.direct&&out.status==='defined'){
      setBadge('DEFINIDO','defined');
      status.textContent='Forma definida no projeto.';
      const item=out.items[0];
      details.textContent=item.roman&&item.roman!==item.output?`Forma fonológica: ${item.roman}`:'';
      return;
    }

    if(out.status==='generated-word'){
      setBadge('FORMADA','proposal');
      status.textContent='Palavra formada automaticamente com o inventário e a fonotática da língua.';
      details.textContent='A mesma entrada sempre produz a mesma forma; palavras já definidas no léxico têm prioridade.';
      return;
    }

    if(out.status==='lexical-phrase'){
      setBadge('LÉXICO','defined');
      status.textContent='A frase usa apenas formas já registradas.';
      details.textContent=out.warning||'';
      return;
    }

    setBadge('FRASE','proposal');
    status.textContent='Tradução automática usando o léxico existente e formação de palavras para o que ainda não estava registrado.';
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
