(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./grammar-v12-reverse.js'));
  else root.DeseraTranslator=factory(root.DeseraTranslator);
})(typeof globalThis!=='undefined'?globalThis:this,function(T){
  'use strict';
  if(!T) throw new Error('grammar-v12-reverse.js precisa carregar antes de grammar-v12-final.js');

  const oldReverse=T.reverse;
  const oldReverseClause=T.reverseClause;
  const demos={je:'este',we:'esse',xo:'aquele'};
  const feminine=new Set(['casa','memória','magia','vida','morte','água','terra','liberdade','identidade','presença','consciência']);
  const adjFem={bom:'boa',bonito:'bonita',feio:'feia',novo:'nova',velho:'velha',fraco:'fraca','rápido':'rápida',lento:'lenta',certo:'certa',errado:'errada',escuro:'escura'};

  function lemma(surface){
    const p=T.parseMorph(surface);
    return {text:p.entry?.pt||p.decoded||String(surface).toLowerCase(),pos:p.entry?.pos||null,plural:Boolean((p.suffixes||[]).some(s=>s.type==='plural'))};
  }
  function agreeDemo(d,n){
    if(!feminine.has(n)) return d;
    return ({este:'esta',esse:'essa',aquele:'aquela'})[d]||d;
  }
  function agreeAdj(a,n){return feminine.has(n)?(adjFem[a]||a):a;}

  function demoClause(source){
    let raw=String(source||'').trim();
    const question=/\?$/.test(raw);
    raw=raw.replace(/[!?.,;:]+$/,'').trim();
    const words=raw.split(/\s+/);
    if(words.length<2||!demos[words[0]]) return null;

    const noun=lemma(words[1]);
    if(!noun.text) return null;
    const d=agreeDemo(demos[words[0]],noun.text);
    const nounText=noun.text+(noun.plural?'s':'');

    if(words.length===2) return `${d} ${nounText}${question?'?':''}`;
    if(words.length===3){
      const pred=lemma(words[2]);
      if(pred.pos==='adj') return `${d} ${nounText} é ${agreeAdj(pred.text,noun.text)}${question?'?':''}`;
    }
    return null;
  }

  T.reverseClause=function(source){return demoClause(source)||oldReverseClause(source);};
  T.reverse=function(text){
    const raw=String(text||'');
    if(!raw.trim()) return oldReverse(raw);
    if(!/(^|[.!?]\s*)(je|we|xo)\s/i.test(raw)) return oldReverse(raw);

    const parts=raw.match(/[^.!?]+[.!?]*|[.!?]+/g)||[raw];
    let used=false;
    const output=parts.map(part=>{
      const punctuation=(part.match(/[.!?]+$/)||[''])[0];
      const body=part.replace(/[.!?]+$/,'').trim();
      if(!body) return punctuation;
      const fixed=demoClause(body+(punctuation.includes('?')?'?':''));
      if(!fixed) return oldReverseClause(body+(punctuation.includes('?')?'?':''))+(punctuation.includes('.')?'.':punctuation.includes('!')?'!':'');
      used=true;
      let out=fixed;
      if(punctuation.includes('.')&&!out.endsWith('.')) out+='.';
      if(punctuation.includes('!')&&!out.endsWith('!')) out+='!';
      return out;
    }).join(' ').replace(/\s+([.!?])/g,'$1').trim();
    return used?{output,status:'grammar-reverse',items:[],unknown:[]}:oldReverse(raw);
  };

  return T;
});