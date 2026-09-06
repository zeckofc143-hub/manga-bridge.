const assert=require('node:assert/strict');
const T=require('../translator-core.js');

function eq(input,expected){
  const out=T.translate(input);
  assert.equal(out.output,expected,`${input} deveria virar ${expected}, recebeu ${out.output}`);
}

// 1) Léxico já definido.
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

// 2) Tradução reversa do léxico definido.
assert.equal(T.reverse('weran').output,'destino');
assert.equal(T.reverse('wëran').output,'destino');
assert.equal(T.reverse('korun').output,'presença');
assert.equal(T.reverse('uran').output,'vontade');
assert.equal(T.reverse('serang').output,'identidade');

// 3) Inventário romanizado.
assert.equal(T.romanization.length,32);
for(const word of ['weran','korun','korevi','tishen','karen','leseri','neran','vera','uran','saren','serang']){
  assert.equal(T.validateRoman(word),true,`${word} precisa caber no inventário romanizado`);
}

// 4) Palavra formada: estável e válida.
const freedom=T.translate('liberdade');
assert.equal(freedom.status,'generated-word');
assert.equal(freedom.items[0].kind,'generated-lexeme');
assert.equal(T.validateNativeShape(freedom.output),true);
assert.equal(T.translate('liberdade').output,freedom.output);
assert.notEqual(T.normalize(freedom.output),T.normalize('liberdade'));

// 5) Reversão via histórico local.
const history={};
history[T.normalizeDesera(freedom.output)]=['liberdade'];
assert.equal(T.reverse(freedom.output,history).output,'liberdade');

// 6) Reversão via busca em lista PT-BR: o motor reencontra a palavra que gerou a forma.
const miniDictionary=['casa','pedra','liberdade','vontade','tempo','universo','história','magia'];
const matches=T.findReverseMatches(miniDictionary,[freedom.output],12);
assert.ok(matches[T.normalizeDesera(freedom.output)].includes('liberdade'));
assert.equal(T.reverse(freedom.output,matches).output,'liberdade');

// 7) Frase exata salva no aparelho volta exatamente, inclusive coisas omitidas/reorganizadas.
const phraseForward=T.translate('eu gosto de liberdade?');
const phraseHistory={[T.normalize(phraseForward.output)]:'eu gosto de liberdade?'};
const phraseBack=T.reverse(phraseForward.output,{},phraseHistory);
assert.equal(phraseBack.output,'eu gosto de liberdade?');
assert.equal(phraseBack.status,'history-exact');

// 8) Varredura ampla: estabilidade + fonotática + baixa colisão.
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
  assert.equal(T.validateNativeShape(out.output),true,`${input} → ${out.output}: forma inválida`);
  assert.equal(out.output,T.translate(input).output,`${input}: precisa ser determinístico`);
  if(!T.findExact(input)) generated.push(out.output);
}
const unique=new Set(generated);
assert.ok(unique.size/generated.length>0.94,`colisões demais: ${unique.size}/${generated.length}`);

// 9) Regressão das frases que denunciaram o erro antigo.
const broken=T.translate('eu gosto de liberdade?');
assert.notEqual(broken.output,'ë aòfza ja ënjëniënif?');
assert.equal(broken.status,'generated-phrase');

// 10) A frase Desera enviada pelo usuário precisa ser aceita pelo reversor, mesmo se o índice ainda estiver vazio.
const legacy='sezhel rorrun tolrodu yavas taspen gisner?';
const legacyEmpty=T.reverse(legacy,{});
assert.equal(legacyEmpty.unknown.length,6);
assert.ok(legacyEmpty.output.endsWith('?'));

console.log(`DESERA_TRANSLATOR_V8_TESTS_OK samples=${samples.length} unique=${unique.size}/${generated.length} liberdade=${freedom.output}`);
