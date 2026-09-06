# Tradutor da Língua — Cubos de Desera

Site estático mobile-first para consultar a língua criada para **Cubos de Desera**.

## O que faz

- Português → romanização em alfabeto latino/ABC.
- Busca reversa ABC → Português.
- Mostra romanização técnica e IPA quando registrados.
- Não inventa palavras automaticamente quando o termo ainda não foi definido.
- Possui rascunhos locais em `localStorage` para testar palavras novas sem alterar o dicionário oficial.

## Exemplo

`destino` → `weran`

Romanização técnica: `wëran`  
IPA: `/wəɾan/`

## Dicionário inicial

Inclui as formas já registradas para Presença, Presença Mental, Atenção, Despertar, Consciência, Memória, Querer, Vontade, Permanecer, Identidade e a forma atual de Destino.

## Arquivos do site

- `index.html`
- `translator.css`
- `translator.js`

Os arquivos antigos do MangaBridge continuam no repositório, mas não são carregados pela página principal atual.

## GitHub Pages

O workflow já existente em `.github/workflows/pages.yml` publica a raiz do repositório na branch `main`.

> Este repositório é o **manga-bridge.** (com ponto no final). O repositório `manga-bridge` sem ponto, usado pela wiki do Pocket Ants, não foi alterado.
