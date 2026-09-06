(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.DeseraTranslator=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  // Léxico já fechado no material da língua + forma de Destino definida no projeto.
  const lexicon=[
    {pt:'destino',aliases:['fado'],simple:'weran',roman:'wëran',ipa:'/wəɾan/',status:'defined',kind:'concept'},
    {pt:'presença mental',aliases:['presenca mental'],simple:'korevi',roman:'korevi',ipa:'/koɾevi/',status:'canon',kind:'noun'},
    {pt:'presença',aliases:['presenca'],simple:'korun',roman:'korun',ipa:'/koɾun/',status:'canon',kind:'noun'},
    {pt:'atenção',aliases:['atencao'],simple:'tishen',roman:'tishen',ipa:'/tiʃen/',status:'canon',kind:'noun'},
    {pt:'despertar',aliases:['desperta','desperto','despertou','despertando'],simple:'karen',roman:'karen',ipa:'/kaɾen/',status:'canon',kind:'verb'},
    {pt:'consciência',aliases:['consciencia'],simple:'leseri',roman:'leseri',ipa:'/leseɾi/',status:'canon',kind:'noun'},
    {pt:'memória',aliases:['memoria','memórias','memorias'],simple:'neran',roman:'neran',ipa:'/neɾan/',status:'canon',kind:'noun'},
    {pt:'querer',aliases:['quero','quer','queremos','querem','queria','queriam','desejar','desejo','deseja','desejam'],simple:'vera',roman:'vera',ipa:'/veɾa/',status:'canon',kind:'verb'},
    {pt:'vontade',aliases:['vontades'],simple:'uran',roman:'uran',ipa:'/uɾan/',status:'canon',kind:'noun'},
    {pt:'permanecer',aliases:['permaneço','permaneco','permanece','permanecem','continuar','continuo','continua','continuam'],simple:'saren',roman:'saren',ipa:'/saɾen/',status:'canon',kind:'verb'},
    {pt:'identidade',aliases:['identidades'],simple:'serang',roman:'serang',ipa:'/seɾaŋ/',status:'canon',kind:'noun'}
  ];

  // 32 fonemas em romanização. A saída "ABC normal" troca è/ë/ò por e/e/o.
  const romanization=[
    'a','e','è','i','ë','o','ò','u','y','w','l','r','m','n','ny','ng',
    'f','v','s','z','sh','zh','h','kh','ch','j','p','b','t','d','k','g'
  ];

  const nativeOnsets=['m','n','l','r','v','s','k','t','y','w','f','p','d','g'];
  const markedOnsets=['sh','zh','h','ch','ny'];
  const commonCodas=['','n','r','l','s'];
  const markedCodas=['ng','k','kh'];
  const simpleVowels=['a','e','i','o','u'];
  const articles=new Set(['o','a','os','as','um','uma','uns','umas']);
  const knownOutputs=new Set(lexicon.map(x=>x.simple));

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

  function ascii(value){
    return String(value||'').toLowerCase().replace(/[ëè]/g,'e').replace(/ò/g,'o');
  }

  function normalizeDesera(value){
    return ascii(String(value||'')).replace(/[^a-z]/g,'');
  }

  const lookup=new Map();
  const reverseLexicon=new Map();
  lexicon.forEach(entry=>{
    [entry.pt,...(entry.aliases||[])].forEach(key=>lookup.set(normalize(key),entry));
    const keys=[entry.simple,entry.roman,ascii(entry.roman)];
    keys.forEach(key=>{
      const k=normalizeDesera(key);
      if(k&&!reverseLexicon.has(k)) reverseLexicon.set(k,entry.pt);
    });
  });

  function findExact(value){
    return lookup.get(normalize(value))||null;
  }

  function findExactReverse(value){
    return reverseLexicon.get(normalizeDesera(value))||null;
  }

  function tokenizeRoman(word){
    const tokens=[];
    let i=0;
    const ordered=['ny','ng','sh','zh','kh','ch'];
    while(i<word.length){
      const pair=word.slice(i,i+2);
      if(ordered.includes(pair)){tokens.push(pair);i+=2;continue;}
      tokens.push(word[i]);
      i++;
    }
    return tokens;
  }

  function validateRoman(value){
    const raw=ascii(String(value||''));
    const tokens=tokenizeRoman(raw);
    const allowed=new Set(romanization.map(ascii));
    return tokens.length>0&&tokens.every(t=>allowed.has(t));
  }

  function hash32(text){
    let h=2166136261;
    for(let i=0;i<text.length;i++){
      h^=text.charCodeAt(i);
      h=Math.imul(h,16777619);
    }
    return h>>>0;
  }

  function next(seed){
    let x=seed>>>0;
    x^=x<<13;
    x^=x>>>17;
    x^=x<<5;
    return x>>>0;
  }

  function pick(list,seed){
    return list[seed%list.length];
  }

  // Detecta uma família funcional para manter palavras relacionadas menos caóticas.
  // Não copia os sons do português.
  function conceptProfile(value){
    let word=normalize(value).replace(/[^a-z0-9]/g,'');
    if(!word) return {key:'vazio',stem:'vazio',type:'root'};

    let type='root';
    let stem=word;
    const rules=[
      ['mente','adverb'],['ções','abstract'],['cao','abstract'],['sao','abstract'],['dade','abstract'],
      ['mento','process'],['agem','process'],['eiro','agent'],['eira','agent'],['ista','agent'],
      ['dor','agent'],['dora','agent'],['oso','quality'],['osa','quality'],['avel','quality'],
      ['ivel','quality'],['ico','quality'],['ica','quality'],['ar','verb'],['er','verb'],['ir','verb']
    ];

    for(const [suffix,t] of rules){
      if(word.length>suffix.length+2&&word.endsWith(suffix)){
        type=t;
        stem=word.slice(0,-suffix.length);
        break;
      }
    }

    if(stem.endsWith('s')&&stem.length>4) stem=stem.slice(0,-1);
    return {key:word,stem:stem||word,type};
  }

  function vowelZone(seed){
    const zones=[['e','i'],['a','e'],['o','u']];
    return zones[seed%zones.length];
  }

  // Mantido idêntico ao motor v7 para que palavras já geradas continuem decodificáveis.
  function makeNativeRootV7(stem,salt){
    let seed=hash32(`${stem}|${salt||''}|desera-v7`);
    const zone=vowelZone(seed);
    const syllableCount=stem.length>=8?3:2;
    let out='';

    for(let i=0;i<syllableCount;i++){
      seed=next(seed+0x9e3779b9+i);
      const useMarked=(seed%13===0);
      const onset=pick(useMarked?markedOnsets:nativeOnsets,seed);
      seed=next(seed);
      let vowel=pick(zone,seed);
      if(i===syllableCount-1&&seed%5===0) vowel=pick(simpleVowels,seed>>>3);
      seed=next(seed);

      let coda='';
      if(i===syllableCount-1||seed%4===0){
        coda=seed%17===0?pick(markedCodas,seed>>>4):pick(commonCodas,seed>>>4);
      }
      out+=onset+vowel+coda;
    }

    if(knownOutputs.has(out)) return makeNativeRootV7(stem,`${salt||''}x`);
    return out;
  }

  function applyGeneratedMorphologyV7(root,type,key){
    const endings={verb:'a',abstract:'i',process:'en',agent:'ar',quality:'el',adverb:'e',root:''};
    const ending=endings[type]||'';
    let out=root;
    if(ending&&!out.endsWith(ending)){
      if(/[aeiou]$/.test(out)&&/^[aeiou]/.test(ending)) out=out.slice(0,-1);
      out+=ending;
    }
    if(out.length>12) out=out.slice(0,12).replace(/(?:sh|zh|kh|ch|ny|ng)?[^aeiou]*$/,'');
    if(out.length<3) out+=pick(['an','en','or'],hash32(key));
    return out;
  }

  function generateLexemeV7(value){
    const profile=conceptProfile(value);
    const root=makeNativeRootV7(profile.stem,profile.type);
    return applyGeneratedMorphologyV7(root,profile.type,profile.key);
  }

  // Alias atual. Mantemos v7 para não quebrar o vocabulário já produzido pelo site.
  const generateLexeme=generateLexemeV7;

  function validateNativeShape(value){
    const word=ascii(String(value||''));
    if(!word||!validateRoman(word)) return false;
    const tokens=tokenizeRoman(word);
    if(tokens[0]==='ng') return false;
    let run=0;
    let vowels=0;
    for(const token of tokens){
      if(simpleVowels.includes(token)){
        vowels++;
        run=0;
      }else{
        run++;
        if(run>=3) return false;
      }
    }
    return vowels>=1;
  }

  function translateOne(value){
    const entry=findExact(value);
    if(entry){
      return {
        input:String(value||''),output:entry.simple,roman:entry.roman,ipa:entry.ipa,
        status:entry.status,kind:'translation',canonical:entry.status==='canon',source:entry.pt
      };
    }

    const generated=generateLexeme(value);
    return {
      input:String(value||''),output:generated,roman:generated,ipa:null,
      status:'generated',kind:'generated-lexeme',canonical:false,source:null
    };
  }

  function splitWords(text){
    return String(text||'').split(/(\s+|[,.!?;:()\[\]{}\-—"“”'’]+)/);
  }

  function isSeparator(part){
    return !part||/^\s+$/.test(part)||/^[,.!?;:()\[\]{}\-—"“”'’]+$/.test(part);
  }

  function translate(text){
    const clean=String(text||'').trim();
    if(!clean) return {output:'',status:'empty',items:[],canonical:false};

    const direct=findExact(clean);
    if(direct){
      const one=translateOne(clean);
      return {output:one.output,status:one.status,items:[one],canonical:one.canonical,direct:true,generatedCount:0};
    }

    if(!/\s/.test(clean)&&!/[,.!?;:]/.test(clean)){
      const one=translateOne(clean);
      return {output:one.output,status:'generated-word',items:[one],canonical:false,direct:false,generatedCount:1};
    }

    const parts=splitWords(text);
    const items=[];
    let generatedCount=0;
    let translatedCount=0;
    const out=[];

    for(const part of parts){
      if(isSeparator(part)){
        out.push(part);
        continue;
      }
      const key=normalize(part);
      if(articles.has(key)){
        items.push({input:part,output:'',status:'grammar-omitted',kind:'article',canonical:false});
        continue;
      }
      const item=translateOne(part);
      items.push(item);
      if(item.kind==='translation') translatedCount++; else generatedCount++;
      out.push(item.output);
    }

    return {
      output:out.join('').replace(/\s+([,.!?;:])/g,'$1').replace(/\s{2,}/g,' ').trim(),
      status:generatedCount?'generated-phrase':'lexical-phrase',
      items,canonical:false,direct:false,translatedCount,generatedCount,
      warning:generatedCount
        ? 'A frase usa palavras formadas automaticamente pelas regras sonoras da língua; o léxico já fechado sempre tem prioridade.'
        : 'Todas as palavras possuem forma lexical registrada; a ordem completa da frase ainda segue apenas as regras gramaticais disponíveis.'
    };
  }

  function candidateList(value){
    if(value==null) return [];
    if(Array.isArray(value)) return value.map(normalize).filter(Boolean);
    return [normalize(value)].filter(Boolean);
  }

  function chooseCandidate(candidates){
    const list=[...new Set(candidateList(candidates))];
    if(!list.length) return null;
    // Para colisões, prefere a forma mais curta e depois ordem alfabética.
    // A UI informa todas as alternativas quando houver ambiguidade.
    list.sort((a,b)=>a.length-b.length||a.localeCompare(b,'pt-BR'));
    return list[0];
  }

  function reverseWord(value,index){
    const key=normalizeDesera(value);
    if(!key) return {input:value,output:value,status:'separator',candidates:[]};

    const known=findExactReverse(key);
    if(known) return {input:value,output:known,status:'lexicon',candidates:[known]};

    let candidates=[];
    if(index instanceof Map) candidates=candidateList(index.get(key));
    else if(index&&typeof index==='object') candidates=candidateList(index[key]);

    if(candidates.length){
      return {
        input:value,output:chooseCandidate(candidates),
        status:candidates.length>1?'ambiguous':'generated-match',candidates:[...new Set(candidates)]
      };
    }

    return {input:value,output:null,status:'unknown',candidates:[]};
  }

  function reverse(text,index,phraseIndex){
    const clean=String(text||'').trim();
    if(!clean) return {output:'',status:'empty',items:[],unknown:[],ambiguous:[]};

    const phraseKey=normalize(clean);
    if(phraseIndex){
      const exact=phraseIndex instanceof Map?phraseIndex.get(phraseKey):phraseIndex[phraseKey];
      if(exact){
        return {output:String(exact),status:'history-exact',items:[],unknown:[],ambiguous:[],exact:true};
      }
    }

    const parts=splitWords(text);
    const items=[];
    const unknown=[];
    const ambiguous=[];
    const out=[];

    for(const part of parts){
      if(isSeparator(part)){
        out.push(part);
        continue;
      }
      const item=reverseWord(part,index);
      items.push(item);
      if(item.status==='unknown'){
        unknown.push(normalizeDesera(part));
        out.push(part);
      }else{
        if(item.status==='ambiguous') ambiguous.push(item);
        out.push(item.output||part);
      }
    }

    return {
      output:out.join('').replace(/\s+([,.!?;:])/g,'$1').replace(/\s{2,}/g,' ').trim(),
      status:unknown.length?'partial':(ambiguous.length?'ambiguous':'reversed'),
      items,unknown:[...new Set(unknown)],ambiguous
    };
  }

  // Recebe uma lista PT-BR e procura somente as formas Desera solicitadas.
  // Isso permite tradução reversa sem guardar um dicionário gigante no celular.
  function findReverseMatches(candidateWords,targetWords,maxCandidates){
    const targets=new Set((targetWords||[]).map(normalizeDesera).filter(Boolean));
    const max=Math.max(1,Number(maxCandidates)||8);
    const result={};
    targets.forEach(t=>{result[t]=[];});
    if(!targets.size) return result;

    for(const raw of candidateWords||[]){
      const word=normalize(raw);
      if(!word||word.length<1||word.length>40||/\s/.test(word)||/[^a-zçáàâãéêíóôõúü-]/i.test(String(raw||''))) continue;
      const generated=normalizeDesera(generateLexemeV7(word));
      if(!targets.has(generated)) continue;
      const bucket=result[generated];
      if(bucket.length<max&&!bucket.includes(word)) bucket.push(word);
    }
    return result;
  }

  function mergeReverseIndexes(base,extra){
    const out={};
    const add=(key,value)=>{
      const k=normalizeDesera(key);
      if(!k) return;
      const vals=candidateList(value);
      if(!out[k]) out[k]=[];
      for(const v of vals) if(v&&!out[k].includes(v)) out[k].push(v);
    };
    if(base instanceof Map) base.forEach((v,k)=>add(k,v));
    else if(base&&typeof base==='object') Object.entries(base).forEach(([k,v])=>add(k,v));
    if(extra instanceof Map) extra.forEach((v,k)=>add(k,v));
    else if(extra&&typeof extra==='object') Object.entries(extra).forEach(([k,v])=>add(k,v));
    return out;
  }

  return {
    lexicon,romanization,normalize,ascii,normalizeDesera,findExact,findExactReverse,
    tokenizeRoman,validateRoman,conceptProfile,generateLexeme,generateLexemeV7,
    validateNativeShape,translateOne,translate,reverseWord,reverse,findReverseMatches,
    mergeReverseIndexes,chooseCandidate
  };
});
