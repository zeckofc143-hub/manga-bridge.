const assert=require('node:assert/strict');
const T=require('../translator-core.js');
const P=require('../pronunciation.js');

function eq(input,expected){
  assert.equal(T.translate(input).output,expected,`${input} -> ${expected}`);
}

// 1) Léxico realmente definido continua acima do modo automático.
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

// 2) A tabela automática é bijetiva: 26 letras diferentes, 26 formas diferentes.
const source='abcdefghijklmnopqrstuvwxyz';
const encodedLetters=[...source].map(ch=>T.encodeAlphabetWord(ch));
assert.equal(new Set(encodedLetters).size,26);
for(const ch of source){
  assert.equal(T.decodeAlphabetWord(T.encodeAlphabetWord(ch)),ch,`round-trip da letra ${ch}`);
}

// 3) Saídas esperadas: curtas e formadas letra/fonema.
assert.equal(T.translate('eu').output,'ia');
assert.equal(T.translate('gosto').output,'duspu');
assert.equal(T.translate('de').output,'ti');
assert.equal(T.translate('liberdade').output,'lovirteti');
assert.equal(T.translate('eu gosto de liberdade?').output,'ia duspu ti lovirteti?');

// 4) Acentos, til, cedilha e caixa sobrevivem sem histórico local.
const orthography=[
  'você','ação','coração','criação','avó','avô','também','Às','CAÇÃO','João','café','pêssego'
];
for(const input of orthography){
  const out=T.encodeAlphabetWord(input);
  const back=T.decodeAlphabetWord(out);
  assert.equal(back,input,`${input} -> ${out} -> ${back}`);
}

// 5) Varredura ampla: qualquer palavra volta exatamente sem internet/dicionário/histórico.
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

const outputs=new Set();
for(const input of samples){
  const exact=T.findExact(input);
  const forward=T.translate(input);
  assert.ok(forward.output,`${input}: saída vazia`);
  assert.equal(T.validateRoman(forward.output),true,`${input} -> ${forward.output}: romanização inválida`);

  if(exact){
    assert.equal(T.reverse(forward.output).output,exact.pt);
  }else{
    assert.equal(T.reverse(forward.output).output,input,`${input} -> ${forward.output} -> ${T.reverse(forward.output).output}`);
    assert.equal(T.decodeAlphabetWord(forward.output),input);
    assert.ok(!outputs.has(forward.output),`colisão em ${input}: ${forward.output}`);
    outputs.add(forward.output);
  }
}

// 6) Frases também são reversíveis fora do aparelho. Léxico canônico continua semântico.
const plainPhrases=[
  'eu gosto de liberdade?',
  'ta entendendo agora porra???',
  'você entende o que eu estou falando?',
  'isso funciona mesmo sem internet.',
  'Olá, mundo!'
];
for(const phrase of plainPhrases){
  const forward=T.translate(phrase);
  const back=T.reverse(forward.output);
  assert.equal(back.output,phrase,`${phrase} -> ${forward.output} -> ${back.output}`);
}

// 7) Histórico continua opcional para restaurar uma frase que misture léxico semântico + flexão contextual.
const original='Eu quero presença.';
const translated=T.translate(original);
const phraseHistory={[T.normalize(translated.output)]:original};
assert.equal(T.reverse(translated.output,{},phraseHistory).output,original);

// 8) Compatibilidade com saídas antigas já usadas pelo autor.
assert.equal(T.reverse('sezhel tolrodu yavas gewes???').output,'ta entendendo agora porra???');
assert.equal(T.reverse('sezhel rorrun tolrodu yavas taspen gisner?').output,'ta me entendendo agora seu cornudo?');

// 9) Pronúncia: palavras canônicas usam a romanização fonológica registrada.
assert.equal(P.romanSourceWord('weran'),'wëran');
assert.equal(P.wordToSpeech('weran'),'uâran');
assert.equal(P.wordToSpeech('tishen'),'tixên');
assert.equal(P.wordToSpeech('serang'),'seran');
assert.equal(P.toSpeechText('weran korun'),'uâran korun');
assert.equal(P.toSpeechText('sh zh kh ch ny'),'x j rr tch nh');

// 10) Regressão do erro inicial.
assert.notEqual(T.translate('eu gosto de liberdade?').output,'ë aòfza ja ënjëniënif?');
assert.notEqual(T.translate('liberdade').output.includes('y'),true,'v10+ não deve usar separador y do v9.1');

console.log(`DESERA_TRANSLATOR_V11_OK samples=${samples.length} unique=${outputs.size}`);
