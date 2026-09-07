const assert=require('node:assert/strict');
const Base=require('../translator-core.js');
require('../grammar-v12.js');
const T=require('../grammar-v12-reverse.js');
const P=require('../pronunciation.js');

assert.equal(T,Base);

const canonical={
  destino:'weran',presença:'korun','presença mental':'korevi',atenção:'tishen',despertar:'karen',
  consciência:'leseri',memória:'neran',querer:'vera',vontade:'uran',permanecer:'saren',identidade:'serang'
};
for(const [pt,de] of Object.entries(canonical)){
  assert.equal(T.translate(pt).output,de,`${pt} -> ${de}`);
  assert.equal(T.reverse(de).output,pt,`${de} -> ${pt}`);
}

const forward=[
  ['eu vejo a coisa.','ne dera nera.'],
  ['você vê a coisa?','va dera nerasa'],
  ['eu não estou vendo a coisa.','ne dera neralino.'],
  ['eu vou para a casa.','ne sorinwa vela.'],
  ['eu fui da casa.','doru ne sorinvo velana.'],
  ['eu faço com água.','ne melafi kora.'],
  ['minha casa é boa.','nele sorin fera.'],
  ['esta casa é boa.','je sorin fera.'],
  ['eu estou falando.','ne senali.'],
  ['eu gosto de magia.','ne haren dusar.'],
  ['eu quero liberdade.','ne savar vera.'],
  ['quem você vê?','va shi nerasa'],
  ['o que você quer?','va kai verasa'],
  ['onde você está?','va davidisa'],
  ['como você fala?','sai va senasa'],
  ['por que você gosta de magia?','vori va haren dusarsa'],
  ['qual casa você quer?','va kei sorin verasa'],
  ['ontem eu vi a coisa.','doru ne dera nerana.'],
  ['amanhã eu vou falar.','wena ne sena.'],
  ['agora eu estou entendendo.','nora ne tolerli.'],
  ['você entende o que eu estou falando?','va ne senali kai tolersa'],
  ['eu penso e falo.','ne mena ya sena.'],
  ['eu gosto de magia mas quero liberdade.','ne haren dusar ru savar vera.'],
  ['Zeo vê Neru.','Zeo Neru nera.'],
  ['minha memória permanece.','nele neran saren.'],
  ['eu gosto de liberdade?','ne savar dusarsa']
];
for(const [pt,de] of forward) assert.equal(T.translate(pt).output,de,pt);

const backward=[
  ['ne dera nera.','eu vejo coisa.'],
  ['va dera nerasa','você vê coisa?'],
  ['ne dera neralino.','eu não estou vendo coisa.'],
  ['ne sorinwa vela.','eu vou para casa.'],
  ['ne melafi kora.','eu faço com água.'],
  ['nele sorin fera.','minha casa é boa.'],
  ['je sorin fera.','esta casa é boa.'],
  ['ne haren dusar.','eu gosto de magia.'],
  ['ne savar vera.','eu quero liberdade.'],
  ['va shi nerasa','quem você vê?'],
  ['va kai verasa','o que você quer?'],
  ['va davidisa','onde você está?'],
  ['vori va haren dusarsa','por que você gosta de magia?'],
  ['va kei sorin verasa','qual casa você quer?'],
  ['va ne senali kai tolersa','você entende o que eu estou falando?'],
  ['nele neran saren.','minha memória permanece.']
];
for(const [de,pt] of backward) assert.equal(T.reverse(de).output,pt,de);

// Morfemas devem ser desmontados antes de tentar o fallback alfabético.
for(const [surface,root,kind,val] of [
  ['nerasa','nera','question','sa'],
  ['neralino','nera','negative','no'],
  ['sorinwa','sorin','relation','wa'],
  ['velana','vela','aspect','na'],
  ['tolerli','toler','aspect','li']
]){
  const p=T.parseMorph(surface);
  assert.equal(p.root,root,surface);
  assert.ok(p.suffixes.some(s=>s.type===kind&&s.value===val),surface);
}

const subjects=['eu','você','eles'];
const objects=['a coisa','o livro','magia','liberdade'];
const verbs=['vejo','quero','entendo','leio'];
let battery=0;
for(const s of subjects) for(const o of objects) for(const v of verbs){
  const pt=`${s} ${v} ${o}.`, out=T.translate(pt).output;
  assert.ok(out.length>2&& !out.includes('undefined') && !out.includes('[object Object]'),pt);
  assert.ok(!/\b(o|a|os|as)\b/i.test(out),`artigo vazou: ${pt} -> ${out}`);
  battery++;
}
const extras=[
  'eu não vejo a coisa.','você não está falando.','eles estão vendo a casa.','eu vou para a escola.',
  'eu faço com água.','esta casa é grande.','aquela casa é pequena.','quem você entende?','o que você vê?',
  'onde você está?','como você fala?','por que você quer liberdade?','qual livro você lê?','hoje eu falo.',
  'ontem eu vi o mundo.','amanhã eu vou aprender.','agora eu estou pensando.','eu penso e falo.',
  'eu quero magia mas gosto de liberdade.','Zeo vê Neru.','Neru vê Zeo.'
];
for(const pt of extras){
  const out=T.translate(pt).output;
  assert.ok(out&& !out.includes('undefined') && !out.includes('[object Object]'),pt);
  battery++;
}
assert.ok(battery>=69);

assert.equal(T.reverse('sezhel tolrodu yavas gewes???').output,'ta entendendo agora porra???');
assert.equal(T.reverse('sezhel rorrun tolrodu yavas taspen gisner?').output,'ta me entendendo agora seu cornudo?');

assert.equal(P.romanSourceWord('weran'),'wëran');
assert.equal(P.wordToSpeech('weran'),'uâran');
assert.ok(P.toSpeechText('ne dera neralino').length>0);
assert.ok(P.toSpeechText('va ne senali kai tolersa').length>0);

assert.notEqual(T.translate('eu gosto de liberdade?').output,'ë aòfza ja ënjëniënif?');
assert.notEqual(T.translate('eu gosto de liberdade?').output,'ia duspu ti lovirteti?');

console.log(`DESERA_TRANSLATOR_V12_FINAL_OK battery=${battery} forward=${forward.length} reverse=${backward.length} canonical=${Object.keys(canonical).length}`);
