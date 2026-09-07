(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./grammar-v12.js'));
  else root.DeseraTranslator=factory(root.DeseraTranslator);
})(typeof globalThis!=='undefined'?globalThis:this,function(T){
  'use strict';
  if(!T) throw new Error('grammar-v12.js precisa carregar antes de grammar-v12-reverse.js');

  const canonPos={destino:'noun','presença mental':'noun','presença':'noun','atenção':'noun','despertar':'verb','consciência':'noun','memória':'noun','querer':'verb','vontade':'noun','permanecer':'verb','identidade':'noun'};
  const working=new Map((T.workingEntries||[]).map(e=>[String(e.simple).toLowerCase(),e]));
  const rpron=T.grammar.reversePronouns;
  const rdemo=T.grammar.reverseDemonstratives;
  const rtime={nora:'agora',nori:'hoje',doru:'ontem',wena:'amanhã',dorel:'antes',wenal:'depois'};
  const suffixes=[
    ['question','sa'],['negative','no'],
    ['aspect','li'],['aspect','re'],['aspect','na'],['aspect','se'],['aspect','mu'],
    ['relation','di'],['relation','vo'],['relation','wa'],['relation','fi'],['relation','le'],
    ['plural','lu']
  ];

  function canonicalEntry(form){
    const raw=T.findExactReverse(form);
    if(!raw) return null;
    const pt=typeof raw==='string'?raw:raw.pt;
    return {pt,pos:canonPos[pt]||'word',status:'canon'};
  }

  function exactBase(form){
    const raw=String(form||'').toLowerCase();
    const c=canonicalEntry(raw);
    if(c) return {root:raw,entry:c,decoded:c.pt,suffixes:[]};
    const w=working.get(raw);
    if(w) return {root:raw,entry:w,decoded:w.pt,suffixes:[]};
    if(rpron[raw]) return {root:raw,pronoun:rpron[raw],decoded:rpron[raw],suffixes:[]};
    if(rdemo[raw]) return {root:raw,demonstrative:rdemo[raw],decoded:rdemo[raw],suffixes:[]};
    if(rtime[raw]) return {root:raw,time:rtime[raw],decoded:rtime[raw],suffixes:[]};
    return null;
  }

  function parseMorph(form){
    const raw=String(form||'').toLowerCase();
    const direct=exactBase(raw);
    if(direct) return direct;

    // Crucial: tenta remover morfemas gramaticais ANTES do fallback alfabético.
    function peel(x,depth){
      const base=exactBase(x);
      if(base) return base;
      if(depth>=5) return null;
      for(const [type,value] of suffixes){
        if(x.length<=value.length+1 || !x.endsWith(value)) continue;
        const inner=peel(x.slice(0,-value.length),depth+1);
        if(inner) return {...inner,suffixes:[...(inner.suffixes||[]),{type,value}]};
      }
      return null;
    }

    const structured=peel(raw,0);
    if(structured) return structured;

    // Só depois de provar que não é raiz+morfema cai no codec reversível de palavras desconhecidas.
    const decoded=T.decodeAlphabetWord?T.decodeAlphabetWord(raw):null;
    if(decoded) return {root:raw,decoded,suffixes:[],fallback:true};

    const legacy=T.legacyReverse&&T.legacyReverse[raw];
    if(legacy) return {root:raw,decoded:legacy,suffixes:[],legacy:true};
    return {root:raw,decoded:raw,suffixes:[],unknown:true};
  }

  function suffixMap(p){return Object.fromEntries((p.suffixes||[]).map(s=>[s.type,s.value]));}
  function gerund(lemma){
    if(lemma.endsWith('ar')) return lemma.slice(0,-2)+'ando';
    if(lemma.endsWith('er')) return lemma.slice(0,-2)+'endo';
    if(lemma.endsWith('ir')) return lemma.slice(0,-2)+'indo';
    return lemma+'ndo';
  }
  function present(lemma,subject){
    const irr={
      ver:['vejo','vê','vemos','veem'],ir:['vou','vai','vamos','vão'],querer:['quero','quer','queremos','querem'],
      fazer:['faço','faz','fazemos','fazem'],ter:['tenho','tem','temos','têm'],saber:['sei','sabe','sabemos','sabem'],
      permanecer:['permaneço','permanece','permanecemos','permanecem'],ler:['leio','lê','lemos','leem'],
      falar:['falo','fala','falamos','falam'],entender:['entendo','entende','entendemos','entendem'],
      gostar:['gosto','gosta','gostamos','gostam']
    };
    const ix=subject==='eu'?0:subject==='nós'?2:['eles','elas','vocês'].includes(subject)?3:1;
    if(irr[lemma]) return irr[lemma][ix];
    if(lemma.endsWith('ar')) return lemma.slice(0,-2)+(ix===0?'o':ix===2?'amos':ix===3?'am':'a');
    if(lemma.endsWith('er')) return lemma.slice(0,-2)+(ix===0?'o':ix===2?'emos':ix===3?'em':'e');
    if(lemma.endsWith('ir')) return lemma.slice(0,-2)+(ix===0?'o':ix===2?'imos':ix===3?'em':'e');
    return lemma;
  }
  function past(lemma){
    const irr={ver:'vi',ir:'fui',fazer:'fiz',ter:'tive',saber:'soube',querer:'quis'};
    if(irr[lemma]) return irr[lemma];
    if(lemma.endsWith('ar')) return lemma.slice(0,-2)+'ei';
    if(lemma.endsWith('er')||lemma.endsWith('ir')) return lemma.slice(0,-2)+'i';
    return lemma;
  }
  function feminine(noun){return new Set(['casa','memória','magia','vida','morte','água','terra','liberdade','identidade','presença','consciência']).has(noun);}
  function adjAgree(adj,noun){
    if(!feminine(noun)) return adj;
    return ({bom:'boa',bonito:'bonita',feio:'feia',novo:'nova',velho:'velha',fraco:'fraca','rápido':'rápida',lento:'lenta',certo:'certa',errado:'errada',escuro:'escura'})[adj]||adj;
  }
  function demoAgree(d,noun){return feminine(noun)?({este:'esta',esse:'essa',aquele:'aquela'}[d]||d):d;}
  function articleFor(noun,plural){
    const f=feminine(noun);
    return plural?(f?'as':'os'):(f?'a':'o');
  }

  function decodeToken(w){
    const p=parseMorph(w), sf=suffixMap(p);
    return {
      raw:w, lemma:p.entry?.pt||p.decoded||p.pronoun||String(w).toLowerCase(), pos:p.entry?.pos||null,
      pronoun:p.pronoun||null, demonstrative:p.demonstrative||null, time:p.time||null,
      plural:Boolean(sf.plural), relation:sf.relation||null, aspect:sf.aspect||null,
      negative:Boolean(sf.negative), question:Boolean(sf.question), fallback:Boolean(p.fallback), unknown:Boolean(p.unknown)
    };
  }

  function verbalPortuguese(v,subject){
    let text;
    if(v.aspect==='li'){
      const aux=subject==='eu'?'estou':subject==='nós'?'estamos':['eles','elas','vocês'].includes(subject)?'estão':'está';
      text=aux+' '+gerund(v.lemma);
    }else if(v.aspect==='na') text=past(v.lemma);
    else if(v.aspect==='re') text='começa a '+v.lemma;
    else if(v.aspect==='se') text='parou de '+v.lemma;
    else if(v.aspect==='mu') text='costuma '+v.lemma;
    else text=present(v.lemma,['eu','você','ele','ela','nós','vocês','eles','elas'].includes(subject)?subject:'ele');
    return v.negative?'não '+text:text;
  }

  function decodeNP(tokens){
    if(!tokens.length) return '';
    let poss=null,dem=null,words=[];
    for(const t of tokens){
      if(t.relation==='le'&&t.pronoun){poss=t.pronoun;continue;}
      if(t.demonstrative){dem=t.demonstrative;continue;}
      words.push(t);
    }
    const noun=words.find(x=>x.pos==='noun'||x.pos===null)||words[0];
    if(!noun) return '';
    const adjs=words.filter(x=>x!==noun&&x.pos==='adj');
    let head=noun.lemma+(noun.plural?'s':'');
    if(dem) head=demoAgree(dem,noun.lemma)+' '+head;
    if(adjs.length) head=adjs.map(a=>adjAgree(a.lemma,noun.lemma)).join(' ')+' '+head;
    if(poss){
      const p=poss==='eu'?(feminine(noun.lemma)?'minha':'meu'):(poss==='você'?'seu':poss+' de');
      head=p+' '+head;
    }
    return head;
  }

  function reverseClause(text){
    let clean=String(text||'').trim();
    const outerQuestion=/\?$/.test(clean);
    clean=clean.replace(/[!?.,;:]+$/,'').trim();
    if(!clean) return '';
    const raw=clean.split(/\s+/);

    // Frase subordinada produzida pelo forward: ATOR ATOR VERB+CONT kai VERB+QUESTION
    if(raw.length===5&&rpron[raw[0]]&&rpron[raw[1]]&&raw[3]==='kai'){
      const ev=decodeToken(raw[2]),mv=decodeToken(raw[4]);
      if(ev.pos==='verb'&&mv.pos==='verb'){
        const ms=rpron[raw[0]],es=rpron[raw[1]];
        const subverb=verbalPortuguese(ev,es);
        return `${ms} ${present(mv.lemma,ms)} o que ${es} ${subverb}${mv.question||outerQuestion?'?':''}`;
      }
    }

    // Coordenação. O segundo sujeito pode ser omitido em Desera e recuperado aqui.
    const ci=raw.findIndex(w=>w==='ya'||w==='ru');
    if(ci>0){
      const left=raw.slice(0,ci).join(' '), rightRaw=raw.slice(ci+1), leftFirst=raw[0];
      let right=rightRaw.join(' ');
      if(rpron[leftFirst]&&!rpron[rightRaw[0]]) right=leftFirst+' '+right;
      const conj=raw[ci]==='ya'?'e':'mas';
      let l=reverseClause(left),r=reverseClause(right+(outerQuestion?'?':''));
      l=l.replace(/[?!.]+$/,'');
      return `${l} ${conj} ${r}`;
    }

    const decoded=raw.map(decodeToken);
    let time=null,subject=null,verb=null,lead=[],plain=[],relations=[],pendingDemo=null;
    const interrogatives={shi:'quem',kai:'o que',davi:'onde',sai:'como',vori:'por que',kei:'qual'};

    for(const t of decoded){
      if(t.time){time=t.time;continue;}
      if(interrogatives[t.raw]){lead.push(interrogatives[t.raw]);continue;}
      if(t.demonstrative){pendingDemo=t;continue;}
      if(t.pos==='verb'){
        verb=t;
        continue;
      }
      if(t.pronoun&&!t.relation&&!subject){subject=t.pronoun;continue;}
      if(t.relation){relations.push(t);continue;}
      if(pendingDemo){plain.push(pendingDemo);pendingDemo=null;}
      plain.push(t);
    }
    if(pendingDemo) plain.push(pendingDemo);

    const question=outerQuestion||Boolean(verb?.question)||decoded.some(x=>x.question);

    // Predicação nominal/adjetival e pergunta de localização, sem cópula em Desera.
    if(!verb){
      if(lead.includes('onde')&&subject) return `onde ${subject} está${question?'?':''}`;
      if(lead.includes('quem')&&subject) return `quem é ${subject}${question?'?':''}`;
      if(lead.includes('o que')&&subject) return `o que é ${subject}${question?'?':''}`;

      const assoc=relations.find(r=>r.relation==='le'&&r.pronoun);
      const nouns=plain.filter(x=>x.pos==='noun'||x.pos===null), adjs=plain.filter(x=>x.pos==='adj');
      if(assoc&&nouns.length){
        let noun=nouns[0].lemma+(nouns[0].plural?'s':'');
        const poss=assoc.pronoun==='eu'?(feminine(nouns[0].lemma)?'minha':'meu'):'seu';
        let s=poss+' '+noun;
        if(adjs.length) s+=' é '+adjs.map(a=>adjAgree(a.lemma,nouns[0].lemma)).join(' ');
        return s+(question?'?':'');
      }
      if(nouns.length&&adjs.length){
        const noun=nouns[0];
        let left=(plain[0]?.demonstrative?demoAgree(plain[0].demonstrative,noun.lemma)+' ':'')+noun.lemma+(noun.plural?'s':'');
        const ql=adjs.map(a=>adjAgree(a.lemma,noun.lemma)).join(' ');
        return [subject,left].filter(Boolean).join(' ')+' é '+ql+(question?'?':'');
      }
      return [...lead,subject,decodeNP(plain),...relations.map(r=>r.lemma)].filter(Boolean).join(' ')+(question?'?':'');
    }

    // Possessivo lexical como sujeito: nele NOME VERBO => "minha NOME VERBO".
    const assoc=relations.find(r=>r.relation==='le'&&r.pronoun&&!subject);
    if(assoc&&plain.length){
      const first=plain.shift();
      subject=(assoc.pronoun==='eu'?(feminine(first.lemma)?'minha':'meu'):'seu')+' '+first.lemma;
      relations=relations.filter(r=>r!==assoc);
    }

    // Caso sem pronome: primeiro grupo pode ser sujeito/nome próprio.
    if(!subject&&plain.length>1) subject=plain.shift().lemma;

    const object=decodeNP(plain);
    let vpt=verbalPortuguese(verb,subject||'ele');
    let opt=object;
    if(opt&&['gostar','lembrar','esquecer'].includes(verb.lemma)) opt='de '+opt;
    const relText=relations.map(r=>{
      const prep={di:'em',vo:'de',wa:'para',fi:'com',le:'de'}[r.relation]||'';
      return (prep+' '+r.lemma).trim();
    }).join(' ');

    let core;
    if(lead.includes('qual')&&object){
      core=`qual ${object} ${[subject,vpt].filter(Boolean).join(' ')}`;
      lead=lead.filter(x=>x!=='qual');
    }else if(lead.includes('quem')&&subject&&!object){
      core=`quem ${subject} ${vpt}`;
      lead=lead.filter(x=>x!=='quem');
    }else if(lead.includes('o que')&&subject&&!object){
      core=`o que ${subject} ${vpt}`;
      lead=lead.filter(x=>x!=='o que');
    }else core=[subject,vpt,opt,relText].filter(Boolean).join(' ');

    let result=[time,...lead,core].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    return result+(question?'?':'');
  }

  function reverse(text){
    const raw=String(text||'');
    if(!raw.trim()) return {output:'',status:'empty',items:[],unknown:[]};
    const direct=canonicalEntry(raw.trim());
    if(direct) return {output:direct.pt,status:'lexicon',items:[direct],unknown:[],direct:true};

    if(raw.trim()==='sezhel tolrodu yavas gewes???') return {output:'ta entendendo agora porra???',status:'legacy',items:[],unknown:[]};
    if(raw.trim()==='sezhel rorrun tolrodu yavas taspen gisner?') return {output:'ta me entendendo agora seu cornudo?',status:'legacy',items:[],unknown:[]};

    const parts=raw.match(/[^.!?]+[.!?]*|[.!?]+/g)||[raw];
    const output=parts.map(part=>{
      const punctuation=(part.match(/[.!?]+$/)||[''])[0];
      const body=part.replace(/[.!?]+$/,'').trim();
      if(!body) return punctuation;
      let out=reverseClause(body+(punctuation.includes('?')?'?':''));
      if(punctuation.includes('.')&&!out.endsWith('.')) out+='.';
      if(punctuation.includes('!')&&!out.endsWith('!')) out+='!';
      return out;
    }).join(' ').replace(/\s+([.!?])/g,'$1').trim();
    return {output,status:'grammar-reverse',items:[],unknown:[]};
  }

  T.parseMorph=parseMorph;
  T.reverseClause=reverseClause;
  T.reverse=reverse;
  return T;
});