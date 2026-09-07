(function(root,factory){
  if(typeof module==='object'&&module.exports){
    module.exports=factory(require('./translator-core.js'));
  }else{
    root.DeseraPronunciation=factory(root.DeseraTranslator);
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(T){
  'use strict';

  const knownRoman=new Map();
  for(const entry of (T&&T.lexicon)||[]){
    knownRoman.set(String(entry.simple||'').toLowerCase(),String(entry.roman||entry.simple||'').toLowerCase());
    knownRoman.set(String(entry.roman||'').toLowerCase(),String(entry.roman||entry.simple||'').toLowerCase());
  }

  const approx={
    a:'a', e:'ê', 'è':'é', i:'i', 'ë':'â', o:'ô', 'ò':'ó', u:'u',
    y:'i', w:'u', l:'l', r:'r', m:'m', n:'n', ny:'nh', ng:'n',
    f:'f', v:'v', s:'s', z:'z', sh:'x', zh:'j', h:'rr', kh:'rr',
    ch:'tch', j:'dj', p:'p', b:'b', t:'t', d:'d', k:'k', g:'g'
  };

  function romanSourceWord(word){
    const lower=String(word||'').toLowerCase();
    return knownRoman.get(lower)||lower;
  }

  function wordToSpeech(word){
    const source=romanSourceWord(word);
    const tokens=T&&T.tokenizeRoman?T.tokenizeRoman(source):null;
    if(!tokens) return source;
    return tokens.map(token=>approx[token]||token).join('');
  }

  function toSpeechText(text){
    return String(text||'').replace(/[A-Za-zèëò]+/g,wordToSpeech);
  }

  function pronunciationGuide(text){
    return toSpeechText(text);
  }

  return {approx,romanSourceWord,wordToSpeech,toSpeechText,pronunciationGuide};
});
