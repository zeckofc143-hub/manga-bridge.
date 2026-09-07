(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.DeseraTranslator=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  // Formas realmente fechadas no projeto. O fallback automático nunca substitui estas.
  const lexicon=[
    {pt:'destino',simple:'weran',roman:'wëran',ipa:'/wəɾan/',status:'defined'},
    {pt:'presença mental',simple:'korevi',roman:'korevi',ipa:'/koɾevi/',status:'canon'},
    {pt:'presença',simple:'korun',roman:'korun',ipa:'/koɾun/',status:'canon'},
    {pt:'atenção',simple:'tishen',roman:'tishen',ipa:'/tiʃen/',status:'canon'},
    {pt:'despertar',simple:'karen',roman:'karen',ipa:'/kaɾen/',status:'canon'},
    {pt:'consciência',simple:'leseri',roman:'leseri',ipa:'/leseɾi/',status:'canon'},
    {pt:'memória',simple:'neran',roman:'neran',ipa:'/neɾan/',status:'canon'},
    {pt:'querer',simple:'vera',roman:'vera',ipa:'/veɾa/',status:'canon'},
    {pt:'vontade',simple:'uran',roman:'uran',ipa:'/uɾan/',status:'canon'},
    {pt:'permanecer',simple:'saren',roman:'saren',ipa:'/saɾen/',status:'canon'},
    {pt:'identidade',simple:'serang',roman:'serang',ipa:'/seɾaŋ/',status:'canon'}
  ];

  const romanization=[
    'a','e','è','i','ë','o','ò','u','y','w','l','r','m','n','ny','ng',
    'f','v','s','z','sh','zh','h','kh','ch','j','p','b','t','d','k','g'
  ];

  // Compatibilidade com algumas saídas antigas já usadas no projeto/chat.
  const legacyReverse={
    sezhel:'ta',
    rorrun:'me',
    tolrodu:'entendendo',
    yavas:'agora',
    taspen:'seu',
    gisner:'cornudo',
    gewes:'porra'
  };

  function normalize(value){
    return String(value||'')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/ç/g,'c')
      .replace(/[“”]/g,'"')
      .replace(/[’]/g,"'")
      .replace(/\s+/g,' ')
      .trim();
  }

  function normalizeWord(value){
    return normalize(value).replace(/[^a-z]/g,'');
  }

  function normalizeDesera(value){
    return String(value||'')
      .toLowerCase()
      .replace(/é/g,'e')
      .replace(/ê/g,'e')
      .replace(/ó/g,'o')
      .replace(/ô/g,'o')
      .replace(/[^a-zèëò]/g,'');
  }

  const lookup=new Map();
  const reverseLexicon=new Map();
  for(const entry of lexicon){
    lookup.set(normalize(entry.pt),entry);
    lookup.set(normalizeWord(entry.pt),entry);
    for(const form of [entry.simple,entry.roman]){
      reverseLexicon.set(normalizeDesera(form),entry.pt);
    }
  }

  function findExact(value){
    return lookup.get(normalize(value))||lookup.get(normalizeWord(value))||null;
  }

  function findExactReverse(value){
    return reverseLexicon.get(normalizeDesera(value))||null;
  }

  // ---------------------------------------------------------------------------
  // FALLBACK REVERSÍVEL V9.1
  // ---------------------------------------------------------------------------
  // O dicionário canônico ainda é pequeno. Para palavras ainda não definidas,
  // o site usa uma forma automática totalmente reversível. Ela NÃO vira cânone.
  // Cada par de letras portuguesas é convertido em uma sílaba CVC válida.
  // O glide "y" funciona como fronteira interna inequívoca entre sílabas do
  // fallback, evitando a ambiguidade de ng/ch/sh etc. que quebrava a versão 9.

  const sourceAlphabet='abcdefghijklmnopqrstuvwxyz_';
  const onsets=['m','n','l','r','v','s','k','t','w','f','p','d','g','b','z','sh','zh','ch','j'];
  const vowels=['a','e','è','i','ë','o','ò','u'];
  const codas=['n','l','r','s','ng'];
  const CODE_SPACE=onsets.length*vowels.length*codas.length; // 760
  const A=257, B=113, A_INV=553; // A*A_INV ≡ 1 (mod 760)

  function pairIndex(pair){
    const a=sourceAlphabet.indexOf(pair[0]);
    const b=sourceAlphabet.indexOf(pair[1]);
    if(a<0||b<0) return -1;
    return a*sourceAlphabet.length+b;
  }

  function indexPair(index){
    const n=sourceAlphabet.length;
    if(index<0||index>=n*n) return null;
    return sourceAlphabet[Math.floor(index/n)]+sourceAlphabet[index%n];
  }

  function permute(index){
    return (index*A+B)%CODE_SPACE;
  }

  function unpermute(index){
    const x=((index-B)%CODE_SPACE+CODE_SPACE)%CODE_SPACE;
    const original=(x*A_INV)%CODE_SPACE;
    return original<sourceAlphabet.length*sourceAlphabet.length?original:-1;
  }

  function codewordFromIndex(index){
    const c=index%codas.length;
    index=Math.floor(index/codas.length);
    const v=index%vowels.length;
    const o=Math.floor(index/vowels.length);
    return onsets[o]+vowels[v]+codas[c];
  }

  function indexFromCodeword(onset,vowel,coda){
    const o=onsets.indexOf(onset),v=vowels.indexOf(vowel),c=codas.indexOf(coda);
    if(o<0||v<0||c<0) return -1;
    return ((o*vowels.length)+v)*codas.length+c;
  }

  function encodePair(pair){
    const idx=pairIndex(pair);
    if(idx<0) return null;
    return codewordFromIndex(permute(idx));
  }

  function checksumLetter(word){
    let h=17;
    for(let i=0;i<word.length;i++) h=(h*33+word.charCodeAt(i))%26;
    return sourceAlphabet[h];
  }

  function encodeGeneratedWord(value){
    const word=normalizeWord(value);
    if(!word) return '';
    const chunks=[encodePair('_'+checksumLetter(word))];
    for(let i=0;i<word.length;i+=2){
      chunks.push(encodePair(word[i]+(word[i+1]||'_')));
    }
    return chunks.join('y');
  }

  const multiTokens=['ny','ng','sh','zh','kh','ch'];
  const tokenSet=new Set(romanization);
  function tokenizeRoman(value){
    const s=String(value||'').toLowerCase();
    const out=[];
    let i=0;
    while(i<s.length){
      const two=s.slice(i,i+2);
      if(multiTokens.includes(two)){
        out.push(two); i+=2; continue;
      }
      const one=s[i];
      if(tokenSet.has(one)){
        out.push(one); i++; continue;
      }
      return null;
    }
    return out;
  }

  function decodeCodewordText(chunk){
    const tokens=tokenizeRoman(chunk);
    if(!tokens||tokens.length!==3) return null;
    const idx=indexFromCodeword(tokens[0],tokens[1],tokens[2]);
    if(idx<0) return null;
    const original=unpermute(idx);
    if(original<0) return null;
    return indexPair(original);
  }

  function decodeGeneratedWord(value){
    const raw=String(value||'').toLowerCase();
    const chunks=raw.split('y');
    if(chunks.length<2||chunks.some(x=>!x)) return null;

    const header=decodeCodewordText(chunks[0]);
    if(!header||header[0]!=='_') return null;

    let decoded='';
    for(let i=1;i<chunks.length;i++){
      const pair=decodeCodewordText(chunks[i]);
      if(!pair||pair[0]==='_') return null;
      decoded+=pair;
    }

    decoded=decoded.replace(/_$/,'');
    if(!/^[a-z]+$/.test(decoded)) return null;
    if(header[1]!==checksumLetter(decoded)) return null;
    return decoded;
  }

  function validateRoman(value){
    const tokens=tokenizeRoman(value);
    return Boolean(tokens&&tokens.length);
  }

  function validateNativeShape(value){
    // Se for fallback V9.1, valida cada bloco CVC separadamente.
    if(String(value||'').includes('y')){
      const chunks=String(value).toLowerCase().split('y');
      if(chunks.length>=2&&chunks.every(chunk=>{
        const t=tokenizeRoman(chunk);
        return t&&t.length===3&&onsets.includes(t[0])&&vowels.includes(t[1])&&codas.includes(t[2]);
      })) return true;
    }

    const tokens=tokenizeRoman(value);
    if(!tokens||!tokens.length) return false;
    if(tokens[0]==='ng') return false;
    let run=0;
    for(const t of tokens){
      if(vowels.includes(t)) run=0;
      else if(++run>2) return false;
    }
    return true;
  }

  function translateWord(value){
    const entry=findExact(value);
    if(entry){
      return {input:value,output:entry.simple,status:entry.status,kind:'lexicon',canonical:entry.status==='canon'};
    }
    const output=encodeGeneratedWord(value);
    return {input:value,output,status:'auto',kind:'generated-lexeme',canonical:false};
  }

  function splitText(text){
    return String(text||'').split(/([A-Za-zÀ-ÖØ-öø-ÿÇç]+|[^A-Za-zÀ-ÖØ-öø-ÿÇç]+)/).filter(Boolean);
  }

  function isWordToken(token){
    return /^[A-Za-zÀ-ÖØ-öø-ÿÇç]+$/.test(token);
  }

  function translate(text){
    const raw=String(text||'');
    if(!raw.trim()) return {output:'',status:'empty',items:[],canonical:false};

    const direct=findExact(raw.trim());
    if(direct){
      const item=translateWord(raw.trim());
      return {output:item.output,status:direct.status,items:[item],canonical:item.canonical,direct:true};
    }

    const items=[];
    let generatedCount=0,lexiconCount=0;
    const output=splitText(raw).map(token=>{
      if(!isWordToken(token)) return token;
      const item=translateWord(token);
      items.push(item);
      if(item.kind==='lexicon') lexiconCount++; else generatedCount++;
      return item.output;
    }).join('');

    return {
      output,
      status:generatedCount?'auto':'lexicon',
      items,canonical:false,direct:false,generatedCount,lexiconCount
    };
  }

  function reverseWord(value){
    const known=findExactReverse(value);
    if(known) return {input:value,output:known,status:'lexicon',kind:'lexicon'};

    const legacy=legacyReverse[normalizeDesera(value)];
    if(legacy) return {input:value,output:legacy,status:'legacy',kind:'legacy'};

    const decoded=decodeGeneratedWord(value);
    if(decoded) return {input:value,output:decoded,status:'decoded',kind:'generated-lexeme'};

    return {input:value,output:value,status:'unknown',kind:'unknown'};
  }

  function reverse(text,history,phraseHistory){
    const raw=String(text||'');
    if(!raw.trim()) return {output:'',status:'empty',items:[],unknown:[]};

    const phraseKey=normalize(raw);
    if(phraseHistory){
      const exact=phraseHistory instanceof Map?phraseHistory.get(phraseKey):phraseHistory[phraseKey];
      if(exact) return {output:String(exact),status:'history-exact',items:[],unknown:[],exact:true};
    }

    const direct=findExactReverse(raw.trim());
    if(direct) return {output:direct,status:'lexicon',items:[{input:raw.trim(),output:direct,status:'lexicon'}],unknown:[],direct:true};

    const items=[];
    const unknown=[];
    const output=splitText(raw).map(token=>{
      if(!isWordToken(token)) return token;

      const key=normalizeDesera(token);
      let hist=null;
      if(history){
        const val=history instanceof Map?history.get(key):history[key];
        if(Array.isArray(val)&&val.length) hist=val[0];
        else if(typeof val==='string') hist=val;
      }
      if(hist){
        const item={input:token,output:hist,status:'history',kind:'history'};
        items.push(item); return hist;
      }

      const item=reverseWord(token);
      items.push(item);
      if(item.status==='unknown') unknown.push(token);
      return item.output;
    }).join('');

    return {output,status:unknown.length?'partial':'reversed',items,unknown};
  }

  return {
    lexicon,romanization,legacyReverse,
    normalize,normalizeWord,normalizeDesera,findExact,findExactReverse,
    tokenizeRoman,validateRoman,validateNativeShape,
    encodeGeneratedWord,decodeGeneratedWord,translateWord,translate,reverseWord,reverse
  };
});
