# DISASTEX — perguntas do Mini Chat (vieram do formulário antigo do site)

Site: repositório `WeNovarks/pixel-perfect-match`. O formulário do site foi trocado por um
botão "Registrarme" que abre `https://josephpay.com/minichat.html?uid=8628ca48-d11f-479f-b995-2f27f4e271e6`.

Nome, telefone e e-mail o Mini Chat já pergunta sozinho (perguntas de contato) — não entram aqui.
O formulário antigo também pedia autorização de contato ("Autorizo a DISASTEX a contactarme...").

Antes: escolher "🇪🇸 Español" em Idioma do Mini Chat (card Mini Chat) e salvar.
Depois colar em Admin → produtor → "Perguntas do Mini Chat" → "Colar resposta".

## Perguntas (só as do formulário do site, mesmas palavras e opções)

A DISASTEX contrata trabalhadores de obra — as perguntas são as do formulário de candidatura.

```json
[
  { "text": "¡Hola! 👋", "subtext": "¿En qué estado vives?", "options": ["Florida", "Georgia", "Alabama", "Texas", "Louisiana", "Mississippi", "South Carolina", "North Carolina", "Tennessee"] },
  { "text": "Perfecto.", "subtext": "¿Tienes experiencia en construcción o limpieza?", "options": ["Sí", "Algo de experiencia", "No"] },
  { "text": "Entendido.", "subtext": "¿Tienes disponibilidad para viajar?", "options": ["Sí", "No"] }
]
```

Pra o Mini Chat pedir o e-mail (o formulário pedia), use destino "E-mail" ou "Ambos".
