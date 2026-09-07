(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.DeseraTranslator=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

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
    return String(value||'').toLowerCase().replace(/[^a-zèëò]/g,'');
  }

  const lookup=new Map();
  const reverseLexicon=new Map();
  const reservedOutputs=new Set();
  for(const entry of lexicon){
    lookup.set(normalize(entry.pt),entry);
    for(const form of [entry.simple,entry.roman]){
      const key=normalizeDesera(form);
      reverseLexicon.set(key,entry.pt);
      reservedOutputs.add(key);
    }
  }
  for(const old of Object.keys(legacyReverse)) reservedOutputs.add(normalizeDesera(old));

  function findExact(value){
    return lookup.get(normalize(value))||null;
  }

  function findExactReverse(value){
    return reverseLexicon.get(normalizeDesera(value))||null;
  }

  // V10: correspondência fixa e reversível. Sem hash, sem sorteio e sem dicionário externo.
  // Palavras já definidas no léxico continuam tendo prioridade absoluta.
  const letterMap={
    a:'e', e:'i', i:'o', o:'u', u:'a',
    b:'v', c:'k', d:'t', f:'f', g:'d', h:'j', j:'zh', k:'kh',
    l:'l', m:'m', n:'n', p:'b', q:'ch', r:'r', s:'s', t:'p',
    v:'z', w:'w', x:'sh', y:'ny', z:'g'
  };

  const reverseLetterMap=new Map(Object.entries(letterMap).map(([pt,de])=>[de,pt]));
  const payloadTokens=[...reverseLetterMap.keys()].sort((a,b)=>b.length-a.length);

  // Marcadores reservados de ortografia. Eles nunca são payload isolado.
  const accentToMarker={
    '\u0301':'ë', // agudo
    '\u0302':'è', // circunflexo
    '\u0303':'ò', // til
    '\u0300':'h', // grave
    '\u0327':'y'  // cedilha
  };
  const markerToAccent=Object.fromEntries(Object.entries(accentToMarker).map(([a,m])=>[m,a]));
  const markerTokens=new Set(Object.keys(markerToAccent));
  const escapePrefix='ë';

  function capitalizeToken(token,upper){
    if(!upper) return token;
    return token.charAt(0).toUpperCase()+token.slice(1);
  }

  function encodeLetterGrapheme(char){
    const decomposed=String(char).normalize('NFD');
    const base=decomposed[0]||'';
    const lower=base.toLowerCase();
    const payload=letterMap[lower];
    if(!payload) return char;

    let out=capitalizeToken(payload,base!==lower);
    for(let i=1;i<decomposed.length;i++){
      const marker=accentToMarker[decomposed[i]];
      if(marker) out+=marker;
    }
    return out;
  }

  function encodeAlphabetWord(value){
    const raw=String(value||'');
    let out='';
    for(const ch of raw) out+=encodeLetterGrapheme(ch);
    const key=normalizeDesera(out);
    if(reservedOutputs.has(key)) out=escapePrefix+out;
    return out;
  }

  function readPayloadAt(raw,pos){
    for(const token of payloadTokens){
      const slice=raw.slice(pos,pos+token.length);
      if(slice.toLowerCase()===token){
        return {token,rawToken:slice,next:pos+token.length};
      }
    }
    return null;
  }

  function decodeAlphabetWord(value){
    let raw=String(value||'');
    if(!raw) return null;

    if(raw.toLowerCase().startsWith(escapePrefix)){
      const candidate=raw.slice(escapePrefix.length);
      if(reservedOutputs.has(normalizeDesera(candidate))) raw=candidate;
    }

    let pos=0;
    let out='';
    while(pos<raw.length){
      const hit=readPayloadAt(raw,pos);
      if(!hit) return null;
      let source=reverseLetterMap.get(hit.token);
      const first=hit.rawToken[0];
      const wasUpper=first&&first===first.toUpperCase()&&first!==first.toLowerCase();
      if(wasUpper) source=source.toUpperCase();
      pos=hit.next;

      let marks='';
      while(pos<raw.length&&markerTokens.has(raw[pos].toLowerCase())){
        marks+=markerToAccent[raw[pos].toLowerCase()];
        pos++;
      }
      out+=(source+marks).normalize('NFC');
    }
    return out;
  }

  // Decoder V9.1 mantido apenas para saídas já produzidas pela versão anterior.
  const oldSourceAlphabet='abcdefghijklmnopqrstuvwxyz_';
  const oldOnsets=['m','n','l','r','v','s','k','t','w','f','p','d','g','b','z','sh','zh','ch','j'];
  const oldVowels=['a','e','è','i','ë','o','ò','u'];
  const oldCodas=['n','l','r','s','ng'];
  const OLD_SPACE=oldOnsets.length*oldVowels.length*oldCodas.length;
  const OLD_B=113, OLD_INV=553;

  function oldIndexPair(index){
    const n=oldSourceAlphabet.length;
    if(index<0||index>=n*n) return null;
    return oldSourceAlphabet[Math.floor(index/n)]+oldSourceAlphabet[index%n];
  }

  function oldIndexFromCodeword(onset,vowel,coda){
    const o=oldOnsets.indexOf(onset),v=oldVowels.indexOf(vowel),c=oldCodas.indexOf(coda);
    if(o<0||v<0||c<0) return -1;
    return ((o*oldVowels.length)+v)*oldCodas.length+c;
  }

  function oldUnpermute(index){
    const x=((index-OLD_B)%OLD_SPACE+OLD_SPACE)%OLD_SPACE;
    const original=(x*OLD_INV)%OLD_SPACE;
    return original<oldSourceAlphabet.length*oldSourceAlphabet.length?original:-1;
  }

  const romanMulti=['ny','ng','sh','zh','kh','ch'];
  const romanSet=new Set(romanization);
  function tokenizeRoman(value){
    const s=String(value||'').toLowerCase();
    const out=[];
    let i=0;
    while(i<s.length){
      const two=s.slice(i,i+2);
      if(romanMulti.includes(two)){out.push(two);i+=2;continue;}
      if(romanSet.has(s[i])){out.push(s[i]);i++;continue;}
      return null;
    }
    return out;
  }

  function oldDecodeChunk(chunk){
    const tokens=tokenizeRoman(chunk);
    if(!tokens||tokens.length!==3) return null;
    const idx=oldIndexFromCodeword(tokens[0],tokens[1],tokens[2]);
    if(idx<0) return null;
    return oldIndexPair(oldUnpermute(idx));
  }

  function oldChecksumLetter(word){
    let h=17;
    for(let i=0;i<word.length;i++) h=(h*33+word.charCodeAt(i))%26;
    return oldSourceAlphabet[h];
  }

  function decodeV91(value){
    const raw=String(value||'').toLowerCase();
    if(!raw.includes('y')) return null;
    const chunks=raw.split('y');
    if(chunks.length<2||chunks.some(x=>!x)) return null;
    const header=oldDecodeChunk(chunks[0]);
    if(!header||header[0]!=='_') return null;
    let decoded='';
    for(let i=1;i<chunks.length;i++){
      const pair=oldDecodeChunk(chunks[i]);
      if(!pair||pair[0]==='_') return null;
      decoded+=pair;
    }
    decoded=decoded.replace(/_$/,'');
    if(!/^[a-z]+$/.test(decoded)) return null;
    if(header[1]!==oldChecksumLetter(decoded)) return null;
    return decoded;
  }

  function validateRoman(value){
    return Boolean(tokenizeRoman(String(value||'').toLowerCase()));
  }

  function translateWord(value){
    const entry=findExact(value);
    if(entry){
      return {input:value,output:entry.simple,status:entry.status,kind:'lexicon',canonical:entry.status==='canon'};
    }
    return {input:value,output:encodeAlphabetWord(value),status:'auto',kind:'alphabet',canonical:false};
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
    let automaticCount=0,lexiconCount=0;
    const output=splitText(raw).map(token=>{
      if(!isWordToken(token)) return token;
      const item=translateWord(token);
      items.push(item);
      if(item.kind==='lexicon') lexiconCount++; else automaticCount++;
      return item.output;
    }).join('');

    return {output,status:automaticCount?'auto':'lexicon',items,canonical:false,direct:false,automaticCount,lexiconCount};
  }

  function reverseWord(value){
    const known=findExactReverse(value);
    if(known) return {input:value,output:known,status:'lexicon',kind:'lexicon'};

    const legacy=legacyReverse[normalizeDesera(value)];
    if(legacy) return {input:value,output:legacy,status:'legacy',kind:'legacy'};

    const decoded=decodeAlphabetWord(value);
    if(decoded) return {input:value,output:decoded,status:'decoded',kind:'alphabet'};

    const old=decodeV91(value);
    if(old) return {input:value,output:old,status:'legacy-v91',kind:'legacy'};

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
      if(history){
        const val=history instanceof Map?history.get(key):history[key];
        const hist=Array.isArray(val)&&val.length?val[0]:(typeof val==='string'?val:null);
        if(hist){items.push({input:token,output:hist,status:'history',kind:'history'});return hist;}
      }

      const item=reverseWord(token);
      items.push(item);
      if(item.status==='unknown') unknown.push(token);
      return item.output;
    }).join('');

    return {output,status:unknown.length?'partial':'reversed',items,unknown};
  }

  return {
    lexicon,romanization,legacyReverse,letterMap,
    normalize,normalizeWord,normalizeDesera,findExact,findExactReverse,
    tokenizeRoman,validateRoman,
    encodeAlphabetWord,decodeAlphabetWord,decodeV91,
    translateWord,translate,reverseWord,reverse
  };
});
