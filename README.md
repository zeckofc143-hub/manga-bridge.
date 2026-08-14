# MangaBridge

Site estático para preparar capítulos do MangaDex para um fluxo de tradução assistida pelo ChatGPT sem usar API de IA no próprio site.

## Fluxo

1. Cole um link de capítulo do MangaDex ou o UUID.
2. O MangaBridge consulta a API pública do MangaDex e carrega as páginas em scroll vertical.
3. Clique em **Baixar tarefa JSON** ou **Copiar tarefa**.
4. Use essa tarefa no ChatGPT para obter uma tradução quando o conteúdo puder ser traduzido.
5. Importe o JSON retornado em **Importar tradução JSON**.
6. A tradução aparece abaixo da página correspondente e pode ser exportada novamente.

## Formato esperado da tradução

```json
{
  "schema": "manga-bridge-translation/v1",
  "chapterId": "UUID-DO-CAPITULO",
  "targetLanguage": "pt-BR",
  "translations": [
    { "page": 1, "text": "Tradução da página 1" },
    { "page": 2, "text": "Tradução da página 2" }
  ]
}
```

## GitHub Pages

O workflow em `.github/workflows/pages.yml` publica automaticamente a branch `main` quando o GitHub Pages estiver configurado para usar **GitHub Actions**.

## Privacidade e custos

- Nenhuma chave de OpenAI, Gemini ou Claude é usada.
- O navegador conversa diretamente com a API pública do MangaDex.
- O site não possui backend próprio nesta versão.
- Use somente conteúdo que você criou, possui ou tem autorização para traduzir.
