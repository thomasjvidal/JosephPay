# DISASTEX — perguntas do Mini Chat (vieram do formulário antigo do site)

Site: repositório `WeNovarks/pixel-perfect-match`. O formulário do site foi trocado por um
botão "Registrarme" que abre `https://josephpay.com/minichat.html?uid=8628ca48-d11f-479f-b995-2f27f4e271e6`.

Nome, telefone e e-mail o Mini Chat já pergunta sozinho (perguntas de contato) — não entram aqui.
O formulário antigo também pedia autorização de contato ("Autorizo a DISASTEX a contactarme...").

Antes: escolher "🇪🇸 Español" em Idioma do Mini Chat (card Mini Chat) e salvar.
Depois colar em Admin → produtor → "Perguntas do Mini Chat" → "Colar resposta".

## Espanhol (público principal do site)

```json
[
  { "text": "¡Hola! Vamos a ver qué oportunidad encaja contigo.", "subtext": "¿En qué estado vives?", "options": ["Florida", "Georgia", "Alabama", "Otro estado"] },
  { "text": "Perfecto.", "subtext": "¿Tienes experiencia en construcción o limpieza?", "options": ["Sí", "Algo de experiencia", "No"] },
  { "text": "Los trabajos son en proyectos de recuperación en el sureste de EE.UU.", "subtext": "¿Tienes disponibilidad para viajar?", "options": ["Sí", "No"] },
  { "text": "Última pregunta.", "subtext": "¿Cuándo podrías empezar?", "options": ["Lo antes posible", "En las próximas semanas", "Solo quiero información"] }
]
```

## Inglês

```json
[
  { "text": "Hi! Let's see which opportunity fits you.", "subtext": "Which state do you live in?", "options": ["Florida", "Georgia", "Alabama", "Another state"] },
  { "text": "Great.", "subtext": "Do you have construction or cleanup experience?", "options": ["Yes", "Some experience", "No"] },
  { "text": "Jobs are on recovery projects across the southeastern US.", "subtext": "Are you available to travel?", "options": ["Yes", "No"] },
  { "text": "Last question.", "subtext": "When could you start?", "options": ["As soon as possible", "In the next few weeks", "Just looking for info"] }
]
```

A 4ª pergunta ("quando poderia começar") é nova — não existia no formulário. Serve pro 🔥
"quente" das métricas ("As soon as possible"). Pode apagar se não quiser.
