const assert=require('node:assert/strict');
const T=require('../translator-core.js');

function eq(input,expected){
  const out=T.translate(input);
  assert.equal(out.output,expected,`${input} deveria virar ${expected}, recebeu ${out.output}`);
}

// Léxico canônico/definido.
eq('destino','weran');
eq('FADO','weran');
eq('presença','korun');
eq('presenca mental','korevi');
eq('atenção','tishen');
eq('despertar','karen');
eq('consciência','leseri');
eq('memória','neran');
eq('quero','vera');
eq('querer','vera');
eq('vontade','uran');
eq('continuar','saren');
eq('permanecer','saren');
eq('identidade','serang');

// O resultado canônico usa apenas a romanização/ABC esperado.
for(const word of ['korun','korevi','tishen','karen','leseri','neran','vera','uran','saren','serang']){
  assert.equal(T.validateRoman(word),true,`${word} precisa caber no inventário romanizado`);
}

// Palavra não registrada: nunca deve fingir cânone.
const unknown=T.translate('liberdade');
assert.equal(unknown.canonical,false);
assert.equal(unknown.status,'draft-phrase');
assert.equal(unknown.items[0].kind,'phonetic-adaptation');
assert.ok(unknown.output.length>0);

// A mesma entrada sempre produz a mesma adaptação.
assert.equal(T.translate('liberdade').output,T.translate('liberdade').output);

// Frase incompleta não pode ser certificada como tradução gramatical.
const phrase=T.translate('eu gosto de liberdade?');
assert.equal(phrase.canonical,false);
assert.equal(phrase.status,'draft-phrase');
assert.ok(phrase.proposalCount>0);
assert.ok(/Frases completas/.test(phrase.warning));

// Regressão: não usar a antiga cifra letra-por-letra que gerou esta sequência.
assert.notEqual(phrase.output,'ë aòfza ja ënjëniënif?');

console.log('DESERA_TRANSLATOR_TESTS_OK');
