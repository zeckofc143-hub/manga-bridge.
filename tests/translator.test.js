const assert=require('node:assert/strict');
const T=require('../translator-core.js');

function eq(input,expected){
  assert.equal(T.translate(input).output,expected,`${input} -> ${expected}`);
}

// Léxico real/definido do projeto.
eq('destino','weran');
eq('presença','korun');
eq('presenca mental','korevi');
eq('atenção','tishen');
eq('despertar','karen');
eq('consciência','leseri');
eq('memória','neran');
eq('querer','vera');
eq('vontade','uran');
eq('permanecer','saren');
eq('identidade','serang');

assert.equal(T.reverse('weran').output,'destino');
assert.equal(T.reverse('wëran').output,'destino');
assert.equal(T.reverse('korun').output,'presença');
assert.equal(T.reverse('uran').output,'vontade');
assert.equal(T.reverse('serang').output,'identidade');
assert.equal(T.romanization.length,32);

// Palavras automáticas precisam ser reversíveis SEM internet, sem dicionário e sem histórico.
const samples=[
  'liberdade','vida','morte','alma','corpo','mente','tempo','espaço','história','criação',
  'magia','realidade','verdade','fato','certeza','probabilidade','possibilidade','escolha','decisão','causa',
  'efeito','lei','regra','ordem','proibição','restrição','poder','força','capacidade','autoridade',
  'energia','habilidade','conhecimento','teoria','prática','erro','falha','honra','orgulho','dignidade',
  'medo','ódio','raiva','ressentimento','inimigo','adversário','ameaça','casa','lar','abrigo',
  'lugar','imagem','imaginar','círculo','refinar','teste','melhorar','consolidar','pessoa','mundo',
  'universo','deus','humano','animal','pedra','fogo','água','vento','terra','luz',
  'escuro','som','silêncio','movimento','parar','correr','andar','ver','perceber','entender',
  'fazendo','construindo','manifestando','dormindo','acordando','lembrando','esquecendo','sentindo','pensando','falando',
  'nome','família','amigo','cidade','torre','escola','livro','caminho','origem','fim',
  'entendendo','agora','porra','gosto','eu','você','ta','me','seu'
];

const generated=new Set();
for(const input of samples){
  const forward=T.translate(input);
  assert.ok(forward.output,`${input}: saída vazia`);
  assert.equal(T.validateRoman(forward.output),true,`${input} -> ${forward.output}: romanização inválida`);
  assert.equal(T.validateNativeShape(forward.output),true,`${input} -> ${forward.output}: forma fonotática inválida`);

  const back=T.reverse(forward.output);
  const expected=T.findExact(input)?T.findExact(input).pt:T.normalizeWord(input);
  assert.equal(T.normalizeWord(back.output),T.normalizeWord(expected),`${input} -> ${forward.output} -> ${back.output}`);

  if(!T.findExact(input)){
    assert.equal(T.decodeGeneratedWord(forward.output),T.normalizeWord(input));
    assert.equal(T.encodeGeneratedWord(input),forward.output,'geração precisa ser determinística');
    assert.ok(!generated.has(forward.output),`colisão em ${input}: ${forward.output}`);
    generated.add(forward.output);
  }
}

// Frases completas também voltam sem rede/histórico (acentos podem ser normalizados no fallback).
const phrases=[
  'eu gosto de liberdade?',
  'ta entendendo agora porra???',
  'você entende o que eu estou falando?',
  'minha memória permanece.',
  'eu quero aprender magia.'
];
for(const phrase of phrases){
  const forward=T.translate(phrase);
  const back=T.reverse(forward.output);
  assert.equal(T.normalize(back.output),T.normalize(phrase),`${phrase} -> ${forward.output} -> ${back.output}`);
}

// Histórico opcional restaura exatamente grafia/caixa da frase original.
const original='Você ESTÁ entendendo agora, porra???';
const translated=T.translate(original);
const phraseHistory={[T.normalize(translated.output)]:original};
assert.equal(T.reverse(translated.output,{},phraseHistory).output,original);

// Compatibilidade com as saídas antigas que o autor já usou no chat.
assert.equal(T.reverse('sezhel tolrodu yavas gewes???').output,'ta entendendo agora porra???');
assert.equal(T.reverse('sezhel rorrun tolrodu yavas taspen gisner?').output,'ta me entendendo agora seu cornudo?');

// Não volta à cifra quebrada antiga.
assert.notEqual(T.translate('eu gosto de liberdade?').output,'ë aòfza ja ënjëniënif?');

console.log(`DESERA_TRANSLATOR_V9_OK samples=${samples.length} generated_unique=${generated.size}`);
