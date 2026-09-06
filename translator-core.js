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

  // Inventário de 32 fonemas/romanização atual do projeto.
  const romanization=[
    'a','e','è','i','ë','o','ò','u','y','w','l','r','m','n','ny','ng',
    'f','v','s','z','sh','zh','h','kh','ch','j','p','b','t','d','k','g'
  ];

  // Compatibilidade com algumas saídas v7/v8 que já foram usadas pelo autor.
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
    // Aceita a mesma palavra sem acento na entrada portuguesa.
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
  // FALLBACK LEXICAL REVERSÍVEL V9
  // ---------------------------------------------------------------------------
  // O léxico canônico é pequeno. Para o site conseguir aceitar QUALQUER palavra
  // sem hash, colisão, dicionário externo ou histórico local, palavras ainda não
  // fechadas recebem uma forma automática reversível composta somente por sons
  // permitidos. Isto é fallback de ferramenta; formas canônicas sempre vencem.
  //
  // Duas letras portuguesas normalizadas -> uma sílaba CVC de Desera.
  // Um cabeçalho com checksum impede que uma palavra nativa qualquer seja
  // decodificada acidentalmente como fallback.

  const sourceAlphabet='abcdefghijklmnopqrstuvwxyz_'; // _ = preenchimento/cabeçalho
  const onsets=['m','n','l','r','v','s','k','t','y','w','f','p','d','g','b','z','sh','zh','ch','j'];
  const vowels=['a','e','è','i','ë','o','ò','u'];
  const codas=['n','l','r','s','ng'];
  const CODE_SPACE=onsets.length*vowels.length*codas.length; // 800
  const A=257, B=113, A_INV=193; // A*A_INV ≡ 1 (mod 800)

  function pairIndex(pair){
    const a=sourceAlphabet.indexOf(pair[0]);
    const b=sourceAlphabet.indexOf(pair[1]);
    if(a<0||b<0) return -1;
    return a*sourceAlphabet.length+b; // 0..728
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
    const header=encodePair('_'+checksumLetter(word));
    let body='';
    for(let i=0;i<word.length;i+=2){
      body+=encodePair(word[i]+(word[i+1]||'_'));
    }
    return header+body;
  }

  // Tokeniza a romanização em fonemas. Como cada fallback é CVC.CVC..., basta
  // agrupar os fonemas de três em três depois do cabeçalho.
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

  function decodeCodeword(tokens,offset){
    if(offset+2>=tokens.length) return null;
    const idx=indexFromCodeword(tokens[offset],tokens[offset+1],tokens[offset+2]);
    if(idx<0) return null;
    const original=unpermute(idx);
    if(original<0) return null;
    return indexPair(original);
  }

  function decodeGeneratedWord(value){
    const tokens=tokenizeRoman(value);
    if(!tokens||tokens.length<6||tokens.length%3!==0) return null;

    const header=decodeCodeword(tokens,0);
    if(!header||header[0]!=='_') return null;

    let decoded='';
    for(let i=3;i<tokens.length;i+=3){
      const pair=decodeCodeword(tokens,i);
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
    // Letras latinas (com acentos) permanecem no token; resto é preservado literalmente.
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

    // Histórico opcional continua servindo apenas para restaurar acentos/caixa/frase exata.
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

      // Histórico de palavra é opcional e só melhora restauração de grafia original.
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
