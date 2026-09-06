const assert=require('node:assert/strict');
const T=require('../translator-core.js');

function eq(input,expected){
  const out=T.translate(input);
  assert.equal(out.output,expected,`${input} deveria virar ${expected}, recebeu ${out.output}`);
}

// 1) Léxico canônico/definido já fechado.
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

// 2) As formas já existentes pertencem ao inventário romanizado.
for(const word of ['weran','korun','korevi','tishen','karen','leseri','neran','vera','uran','saren','serang']){
  assert.equal(T.validateRoman(word),true,`${word} precisa caber no inventário romanizado`);
}

// 3) Palavras novas são FORMADAS, não cifradas nem copiadas do português.
const freedom=T.translate('liberdade');
assert.equal(freedom.status,'generated-word');
assert.equal(freedom.items[0].kind,'generated-lexeme');
assert.equal(freedom.canonical,false);
assert.equal(T.validateNativeShape(freedom.output),true);
assert.notEqual(T.normalize(freedom.output),T.normalize('liberdade'));
assert.equal(T.translate('liberdade').output,freedom.output,'a mesma ideia precisa gerar a mesma forma');

// 4) Varredura ampla: estabilidade + fonotática + baixa colisão.
const samples=[
  'liberdade','vida','morte','alma','corpo','mente','tempo','espaço','história','criação',
  'magia','realidade','verdade','fato','certeza','probabilidade','possibilidade','escolha','decisão','causa',
  'efeito','lei','regra','ordem','proibição','restrição','poder','força','capacidade','autoridade',
  'energia','habilidade','conhecimento','teoria','prática','erro','falha','honra','orgulho','dignidade',
  'medo','ódio','raiva','ressentimento','inimigo','adversário','ameaça','casa','lar','abrigo',
  'lugar','imagem','imaginar','círculo','refinar','teste','melhorar','consolidar','pessoa','mundo',
  'universo','deus','humano','animal','pedra','fogo','água','vento','terra','luz',
  'escuro','som','silêncio','movimento','parar','correr','andar','ver','perceber','entender',
  'fazer','construir','manifestar','dormir','acordar','lembrar','esquecer','sentir','pensar','falar',
  'nome','família','amigo','cidade','torre','escola','livro','caminho','origem','fim'
];

const generated=[];
for(const input of samples){
  const out=T.translate(input);
  assert.ok(out.output,`${input}: precisa gerar saída`);
  assert.equal(T.validateNativeShape(out.output),true,`${input} → ${out.output}: forma precisa respeitar inventário/fonotática`);
  assert.equal(out.output,T.translate(input).output,`${input}: geração precisa ser determinística`);
  if(!T.findExact(input)){
    assert.notEqual(T.normalize(out.output),T.normalize(input),`${input}: não pode ser só o português devolvido`);
    generated.push(out.output);
  }
}
const unique=new Set(generated);
assert.ok(unique.size/generated.length>0.94,`colisões demais: ${unique.size}/${generated.length}`);

// 5) Artigos portugueses não viram palavras obrigatórias no modo frase.
const withArticle=T.translate('a liberdade');
assert.ok(!withArticle.output.startsWith('a '),'artigo português não deve sobreviver como artigo obrigatório');

// 6) Frase: nunca volta à cifra antiga e mantém pontuação.
const phrase=T.translate('eu gosto de liberdade?');
assert.equal(phrase.status,'generated-phrase');
assert.equal(phrase.canonical,false);
assert.ok(phrase.generatedCount>0);
assert.ok(phrase.output.endsWith('?'));
assert.notEqual(phrase.output,'ë aòfza ja ënjëniënif?');

// 7) Inventário básico: 32 entradas de romanização.
assert.equal(T.romanization.length,32);

console.log(`DESERA_TRANSLATOR_TESTS_OK samples=${samples.length} unique=${unique.size}/${generated.length}`);
