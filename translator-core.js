(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.DeseraTranslator=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const lexicon=[
    {pt:'destino',aliases:['fado'],simple:'weran',roman:'wëran',ipa:'/wəɾan/',status:'session',kind:'concept'},
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

  const romanization=[
    'a','e','è','i','ë','o','ò','u','y','w','l','r','m','n','ny','ng',
    'f','v','s','z','sh','zh','h','kh','ch','j','p','b','t','d','k','g'
  ];

  const vowels=new Set(['a','e','è','i','ë','o','ò','u']);
  const finalCommon=new Set(['n','ng','l','r','s']);
  const finalMarked=new Set(['k','kh']);
  const illegalFinal=new Set(['b','d','g','v','z','zh','j']);

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
      tokens.push(word[i]);i++;
    }
    return tokens;
  }

  function ptToSoundSketch(value){
    let s=normalize(value)
      .replace(/[^a-z\s-]/g,'')
      .replace(/nh/g,'ny')
      .replace(/lh/g,'l')
      .replace(/rr/g,'r')
      .replace(/qu(?=[ei])/g,'k')
      .replace(/gu(?=[ei])/g,'g')
      .replace(/ch/g,'sh')
      .replace(/j/g,'zh')
      .replace(/g(?=[ei])/g,'zh')
      .replace(/c(?=[ei])/g,'s')
      .replace(/c/g,'k')
      .replace(/q/g,'k')
      .replace(/x/g,'sh')
      .replace(/ão/g,'an')
      .replace(/õe/g,'on')
      .replace(/ãe/g,'an')
      .replace(/y/g,'y');
    return s;
  }

  function repairNativeShape(word){
    let tokens=tokenizeRoman(word.replace(/[^a-zèëò]/g,''));
    if(!tokens.length) return '';

    // /ŋ/ não inicia palavra nativa.
    if(tokens[0]==='ng') tokens.unshift('a');

    // Insere schwa quando aparecem três consoantes seguidas ou um ataque muito pesado.
    const repaired=[];
    let consonants=0;
    for(const token of tokens){
      if(vowels.has(token)){
        consonants=0;
        repaired.push(token);
        continue;
      }
      consonants++;
      if(consonants>=3){
        repaired.push('ë');
        consonants=1;
      }
      repaired.push(token);
    }
    tokens=repaired;

    // Finais pesados não nativos recebem uma vogal de apoio.
    const last=tokens[tokens.length-1];
    if(illegalFinal.has(last)) tokens.push('a');

    // Mantém codas usuais; codas marcadas são permitidas, mas não são fabricadas à força.
    return tokens.join('');
  }

  function adaptSound(value){
    const sketch=ptToSoundSketch(value).replace(/[\s-]+/g,'');
    return ascii(repairNativeShape(sketch));
  }

  function validateRoman(value){
    const raw=String(value||'').toLowerCase();
    const tokens=tokenizeRoman(raw);
    const allowed=new Set(romanization);
    return tokens.length>0&&tokens.every(t=>allowed.has(t));
  }

  function translateOne(value){
    const entry=findExact(value);
    if(entry){
      return {
        input:String(value||''),
        output:entry.simple,
        roman:entry.roman,
        ipa:entry.ipa,
        status:entry.status,
        kind:'translation',
        canonical:entry.status==='canon',
        source:entry.pt
      };
    }

    const proposal=adaptSound(value);
    return {
      input:String(value||''),
      output:proposal,
      roman:proposal,
      ipa:null,
      status:'proposal',
      kind:'phonetic-adaptation',
      canonical:false,
      source:null
    };
  }

  function splitWords(text){
    return String(text||'').split(/(\s+|[,.!?;:()\[\]{}\-—"“”'’]+)/);
  }

  function translate(text){
    const clean=String(text||'').trim();
    if(!clean) return {output:'',status:'empty',items:[],canonical:false};

    const direct=findExact(clean);
    if(direct){
      const one=translateOne(clean);
      return {output:one.output,status:one.status,items:[one],canonical:one.canonical,direct:true};
    }

    const wordParts=splitWords(text);
    const lexical=[];
    let proposalCount=0;
    let translatedCount=0;
    const out=wordParts.map(part=>{
      if(!part||/^\s+$/.test(part)||/^[,.!?;:()\[\]{}\-—"“”'’]+$/.test(part)) return part;
      const item=translateOne(part);
      lexical.push(item);
      if(item.kind==='translation') translatedCount++; else proposalCount++;
      return item.output||part;
    }).join('');

    return {
      output:out,
      status:proposalCount===0?'lexical-only':'draft-phrase',
      items:lexical,
      canonical:false,
      direct:false,
      translatedCount,
      proposalCount,
      warning:'Frases completas ainda não podem ser chamadas de tradução gramatical quando usam palavras ou morfemas que ainda não foram definidos.'
    };
  }

  return {
    lexicon,
    romanization,
    normalize,
    ascii,
    findExact,
    adaptSound,
    validateRoman,
    translateOne,
    translate
  };
});
