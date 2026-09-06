(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.DeseraTranslator=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  // Léxico já fechado no material da língua + forma de Destino definida neste projeto.
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
    return String(value||'').replace(/[ëè]/g,'e').replace(/ò/g,'o');
  }

  const lookup=new Map();
  lexicon.forEach(entry=>{
    [entry.pt,...(entry.aliases||[])].forEach(key=>lookup.set(normalize(key),entry));
  });

  function findExact(value){
    return lookup.get(normalize(value))||null;
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
    const raw=String(value||'').toLowerCase();
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

  // Detecta apenas a família funcional para manter palavras relacionadas menos caóticas.
  // Não tenta copiar os sons do português.
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

  function makeNativeRoot(stem,salt){
    let seed=hash32(`${stem}|${salt||''}|desera-v7`);
    const zone=vowelZone(seed);
    const syllableCount=stem.length>=8?3:2;
    let out='';

    for(let i=0;i<syllableCount;i++){
      seed=next(seed+0x9e3779b9+i);
      const useMarked=(seed%13===0); // sons mais marcados permanecem raros.
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

    // Evita colisão com o pequeno léxico já estabelecido.
    if(knownOutputs.has(out)) return makeNativeRoot(stem,`${salt||''}x`);
    return out;
  }

  function applyGeneratedMorphology(root,type,key){
    // Estas terminações são do motor automático, não afixos canônicos da língua.
    // Servem apenas para conservar alguma família entre conceitos gerados.
    const endings={verb:'a',abstract:'i',process:'en',agent:'ar',quality:'el',adverb:'e',root:''};
    const ending=endings[type]||'';
    let out=root;
    if(ending&& !out.endsWith(ending)){
      if(/[aeiou]$/.test(out)&&/^[aeiou]/.test(ending)) out=out.slice(0,-1);
      out+=ending;
    }

    // Mantém a saída curta e dentro do perfil normal de raiz/derivação.
    if(out.length>12) out=out.slice(0,12).replace(/(?:sh|zh|kh|ch|ny|ng)?[^aeiou]*$/,'');
    if(out.length<3) out+=pick(['an','en','or'],hash32(key));
    return out;
  }

  function generateLexeme(value){
    const profile=conceptProfile(value);
    const root=makeNativeRoot(profile.stem,profile.type);
    return applyGeneratedMorphology(root,profile.type,profile.key);
  }

  function validateNativeShape(value){
    const word=String(value||'').toLowerCase();
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

    // Palavra/conceito único: cria uma entrada lexical estável seguindo a fonotática,
    // em vez de cifrar ou copiar os sons do português.
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
      // A língua não exige artigo obrigatório; no modo frase os artigos portugueses são omitidos.
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

  return {
    lexicon,romanization,normalize,ascii,findExact,tokenizeRoman,validateRoman,
    conceptProfile,generateLexeme,validateNativeShape,translateOne,translate
  };
});
