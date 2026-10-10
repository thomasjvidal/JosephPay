# JosephPay — Regras para o Claude

## REGRA CRÍTICA: nunca subir pra main sem o Thomas aprovar

Antes de qualquer push/merge na `main`, mostre o que mudou (prints/resumo) e espere o
Thomas dizer que pode. Trabalhe num ramo `claude/...` até lá.

## Visual: ícones, nunca emoji em botão

Botões e rótulos da interface usam `<Ic n="copy"/>` (traço fino estilo Apple, `IC` em
`index.html`) e `iconBtn()` pra botão só de ícone (vidro). Emoji só em CONTEÚDO de
mensagem (WhatsApp, Mini Chat, e-mail) — e o 🎂 do aniversário, que o Thomas preferiu em emoji.

## REGRA CRÍTICA: IDs de botões são permanentes

Os botões abaixo têm IDs fixos usados pelo GTM para rastreamento de conversões.
**NUNCA renomeie, remova ou altere esses IDs.** Se precisar refatorar o botão,
mantenha o `id` exatamente como está.

### checkout.html
| ID | Botão |
|----|-------|
| `btn-continuar` | Continuar → (etapa 1 → etapa 2) |
| `btn-pagar` | Pagar R$ X,XX (etapa 2 → pagamento) |
| `btn-voltar` | ← Voltar (etapa 2 → etapa 1) |

### index.html
| ID | Botão |
|----|-------|
| `btn-novo-produto` | + Novo produto |
| `btn-sacar` | Sacar |
| `btn-conectar-whatsapp` | Conectar / Verificar WhatsApp |
| `btn-nova-acao` | Nova ação (CRM) |
| `btn-adicionar-lead` | + Adicionar (CRM) |
| `btn-importar-leads` | Importar CSV (CRM) |
| `btn-exportar-leads` | Exportar CSV (CRM) |
| `btn-salvar-funil` | Salvar funil |
| `btn-gerenciar-produto` | Gerenciar Produto |
| `btn-copiar-link` | Copiar link (produto) |
| `btn-logout` | Sair da conta |

## GTM por produto

O campo `gtm_id` na tabela `products` do Supabase controla qual GTM carrega
em cada checkout. O GTM é injetado dinamicamente — nunca hardcode IDs de GTM
no HTML.

## Evento dataLayer no checkout

Ao clicar em `btn-continuar`, o checkout dispara:
```js
dataLayer.push({
  event: "begin_checkout",
  full_name, email, phone, cpf, zip_code, date_of_birth
})
```
Não altere o nome do evento `begin_checkout` nem as chaves do objeto.

## Tabela tracking.begin_checkout

Schema: `tracking`. Acesso via anon key (INSERT + SELECT). Não altere o schema
nem remova colunas — o sGTM do Ramon depende de todas elas.

## REGRA CRÍTICA: cuidado com fluxo financeiro e mensagens dos produtores

O Thomas é leigo tecnicamente e pediu explicitamente pra eu sempre ter cuidado
extra nessas duas áreas — não mexer nelas sem ele pedir claramente:

- **Fluxo financeiro dos produtores**: cálculo de taxas, vendas, assinaturas
  (MRR), saques, ledger, comissão de afiliados. Reorganizar ONDE essas telas
  aparecem (ex: agrupar em sub-abas) é OK; mexer na LÓGICA de cálculo, nos
  endpoints que movem dinheiro, ou no schema dessas tabelas não é — só faça
  isso se for exatamente o que foi pedido.
- **Fluxo sério de mensagens**: envio de WhatsApp/e-mail (disparos em massa,
  captura de lead, `sendToWhatsApp`/`sendToEmail` do Mini Chat, SMTP). Mesma
  regra: reposicionar na UI tudo bem, mudar o comportamento de envio não.

Regra geral pra qualquer mudança no Admin (painel do Thomas): sempre manter
lógica e coerência pensando num usuário leigo, mas **nunca remover
capacidade** — se algo precisa ficar mais simples, reorganize/oculte, não
apague. Na dúvida se uma mudança é só reorganização ou é mudança de
comportamento real, pergunte antes.

## REGRA CRÍTICA: padrões obrigatórios pra instalação em repositório de cliente

O Thomas pediu explicitamente que os erros abaixo (descobertos com o
Temakeria Box e o Dr. Ramon) nunca se repitam — nem nos produtores que já
existem, nem nos que forem cadastrados daqui pra frente. Qualquer endpoint
que escreve no repositório GitHub de um cliente (instalar Mini Chat, sensor,
trocar botões, trocar imagem) precisa respeitar isso:

1. **O Mini Chat NÃO é mais um arquivo estático em `public/` — é uma regra
   de REDIRECIONAMENTO no `vercel.json`** (`ensureMinichatRedirect()`,
   `api/server.js`). Um arquivo estático só funciona se a gente adivinhar
   certo como aquele framework específico serve `public/`, e cada framework
   faz diferente (ou nem faz, se tiver servidor próprio com rota "pega-tudo"
   — TanStack Start, Remix, Nuxt). Um redirecionamento no `vercel.json` é
   resolvido pelo Vercel na borda, antes de qualquer código do framework
   rodar — funciona igual pra QUALQUER tipo de repositório, conhecido ou
   não, sem precisar adivinhar nada. Nunca volte a criar arquivo estático
   pra esse fim — foi tentado, quebrou no primeiro framework com servidor
   próprio (TanStack Start, a Lervet) porque a rota "pega-tudo" do próprio
   app interceptava a requisição antes do arquivo. Se algum dia PRECISAR
   criar um arquivo novo num repo de cliente por outro motivo, aí sim use
   `detectRepoFramework()`/`public/` — mas não é mais o caso do Mini Chat.
   **Exceção descoberta na CAA (02/10):** site com servidor próprio que publica
   pelo formato "Build Output" da Vercel (Nitro: TanStack Start/Lovable, e
   parecidos — `unknownFramework`) **ignora as regras do `vercel.json`**,
   inclusive `redirects`. Ali o redirecionamento nunca funciona, mesmo com a
   publicação passando; o caminho é trocar o botão/rota no código ("Corrigir
   agora" / `apply-links`). `verifyMinichatLive()` já explica isso no "por quê".
2. **Scanner de links/botões precisa tratar `${...}` como bloco atômico.**
   Mensagens de WhatsApp pré-preenchidas (`` `https://wa.me/${tel}?text=${encodeURIComponent('Olá, ...')}` ``)
   têm aspas e vírgulas DENTRO do `${}` — um regex ingênuo corta a captura ali
   e gera um href quebrado que nunca bate com o arquivo real na hora de
   aplicar a troca. Use sempre `STR_CONTENT`/`extractLinksFromContent`
   (`api/server.js`), nunca um regex novo e mais simples pra isso.
3. **"Botões do site" só pode aparecer verde se TODOS os links de WhatsApp
   (`wa.me`/`api.whatsapp.com`) do repositório já apontarem pro Mini Chat** —
   nunca considerar "pronto" só porque UM link bateu. Um site tem vários
   CTAs; corrigir só um e marcar tudo como concluído engana o Thomas.
4. **Depois de instalar/reinstalar qualquer coisa num repo de cliente,
   ofereça (ou rode sozinho) uma verificação real no site publicado**
   (`verify-minichat` é o padrão) — nunca reportar sucesso só porque o commit
   no GitHub deu certo. Commit certo não é o mesmo que "está no ar".
5. **Toda vez que a IA embutida do JosephPay puder resolver algo, resolva
   dentro do Admin** — nunca devolver um "copie isto e cole no ChatGPT" como
   única opção; isso é uma dependência externa que o Thomas quer eliminada.
   Se um fluxo assim já existir, priorize automatizar com `callGroq`/
   `callAnthropic` em vez de manter só o copiar/colar manual.
6. **Framework que a JosephPay sabe montar de cor (Vite, Next, HTML estático)
   continua sendo cuidado sempre — inclusive corrigido quando estiver errado —
   mesmo em produtor antigo que ainda não tinha `github_vercel_config_sha`
   salvo.** A trava de "não sobrescrever" só vale em dois casos: (a) framework
   fora da lista que sabemos montar de cor (`unknownFramework` em
   `detectRepoFramework()` — TanStack Start é o primeiro caso, mas serve pra
   qualquer framework novo que vier); (b) já tínhamos uma "impressão digital"
   salva desse arquivo (a JosephPay escreveu ele antes) e o sha atual não bate
   mais — sinal de que alguém mudou por fora DEPOIS que passamos a cuidar
   dele. Nunca travar o caso comum (Vite/Next sem sha salvo ainda) como se
   fosse customização — isso deixaria produtor antigo preso pra sempre. Foi
   assim que um vercel.json customizado pra TanStack Start virou um genérico
   de Vite e quebrou o deploy publicado da Lervet — o site tinha rodado o
   diagnóstico automático em segundo plano. `ensureVercelConfig()` faz MERGE
   com o conteúdo existente (nunca substitui o arquivo inteiro) — precisa
   continuar assim pra não apagar a chave `redirects` do Mini Chat
   (`ensureMinichatRedirect()`, regra 1) toda vez que rodar.
7. **`applyLinksToRepo()` (troca de link) NUNCA roda sozinha, nem pra um
   `wa.me`/`api.whatsapp.com` cru** — só via admin que abriu "Botões do site",
   olhou o arquivo/texto do botão e clicou Aplicar. Achávamos que wa.me cru
   era sempre seguro de trocar sozinho ("não tem outro uso possível"), mas a
   Lervet provou o contrário duas vezes: um link interno ("Go home") virou
   Mini Chat sem querer, E o `sendToWhatsApp` final do mini chat que o
   próprio cliente já tinha construído também era um wa.me — trocar esse
   sozinho virou um loop (quem termina de responder cai de novo no chat em
   vez de falar com alguém). `pendingChatLinks()`/`autofixSiteIssues()`
   continuam DETECTANDO e avisando (site-audit, checklist), nunca aplicando.
   Use `pendingChatLinks()` só pra AVISAR (checklist, diagnóstico); a troca em
   si só roda via `applyLinksToRepo()` chamada por um admin que olhou o
   arquivo e o texto do botão em "Botões do site", nunca pelo job automático.
8. **Ao mudar o caminho de um arquivo que a JosephPay controla num repo de
   cliente, ou ao migrar do mecanismo antigo de arquivo estático pro
   redirecionamento (regra 1), apague o arquivo antigo** (`deleteStaleMinichatFile()`)
   — senão sobra duplicado pra sempre, também descoberto na Lervet.
9. **Resolução de variável (`href={NOME}`) tem que varrer o repositório
   INTEIRO, nunca só arquivos com nome de convenção** (`site.ts`,
   `constants.ts` etc. — `scanRepoJsxLinks()`). A constante pode estar
   declarada sem `export`, dentro do próprio arquivo de rota que a usa — foi
   o caso da Lervet (`const MINICHAT` direto em `src/routes/index.tsx`), um
   lugar que a busca restrita por nome de arquivo nunca ia olhar. Por isso
   `scanRepoJsxLinks()` lê o conteúdo de todo arquivo primeiro e só DEPOIS
   monta o mapa de variáveis olhando todos eles — sem essa ordem (variável
   resolvida só por arquivos "candidatos") sempre existe algum framework novo
   que declara a constante num lugar que a heurística de nome não cobre, e aí
   volta o mesmo erro genérico de "link não encontrado" pro Thomas. Também
   aceita valor de rota interna (`/minichat`, `/atendimento`), não só
   `https://` — nem todo link rival é WhatsApp.
10. **`scanRepoJsxLinks()` precisa varrer TODA extensão de framework que
    `detectRepoFramework()` já sabe reconhecer** — descoberto na auditoria
    geral: o detector já identificava Vue/Svelte/Astro (pra nunca sobrescrever
    o `vercel.json` deles, regra 6), mas o scanner de botões só olhava
    `.tsx/.jsx/.ts/.js/.html` — pra um produtor futuro nesses frameworks,
    "Botões do site"/"Corrigir botão agora" sempre dava "não achei nada",
    mesmo com o botão visível no `<template>`. Se `detectRepoFramework()`
    ganhar suporte a outro framework no futuro, adicione a extensão dele
    aqui também (`api/server.js`, filtro de `arquivos` em `scanRepoJsxLinks`).

Antes de fechar qualquer tarefa que mexe nesses endpoints, considere rodar
(ou sugerir ao Thomas) a mesma correção nos produtores que já existem, não só
no que motivou a mudança — o objetivo é o Admin inteiro ficar consistente,
não só o caso que gerou a reclamação.

## Mini Chat: modo E-mail, idioma e visual

- **Modo "E-mail"/"Ambos" manda o diagnóstico sozinho pelo servidor**
  (`POST /api/minichat/lead-email`, Resend). O destinatário vem SEMPRE do
  `minichat_config.email_destino` salvo no banco — nunca do corpo da requisição
  (senão vira relay aberto de e-mail). Se o envio falhar, o `minichat.html` cai no
  jeito antigo (`mailto:`), nunca deixa o lead sem caminho.
- **Modo só-WhatsApp não passa por nada disso.** Os textos em `I18N.pt` do
  `minichat.html` são exatamente os de antes — mudar qualquer um deles muda o Mini
  Chat (e a mensagem do WhatsApp) de TODO produtor atual.
- **Mensagem final (02/10, pedido do Thomas):** `buildMessage()` monta "Olá, *Marca*! 👋 / (linha em branco) /
  Sou *Nome*… / 📋 *Meu perfil* / — *pergunta* resposta / fechamento". Só nome + respostas —
  telefone, e-mail e nascimento NÃO entram no WhatsApp (já vão pro CRM). No e-mail
  (`buildMessage('email')`, sem asteriscos) entra o telefone, nunca e-mail/nascimento.
  Emojis só 👋 e 📋; marcador é travessão "—" (formato aprovado pelo Thomas). O e-mail do lead (Resend) mostra só nome + telefone.
- **Botão "Enviar por e-mail" abre o app de e-mail da pessoa** (`mailto:` com a mensagem
  pronta) — o envio automático pelo servidor continua em paralelo, uma vez só.
- `minichat_config.language` (`pt`|`en`, padrão `pt`) muda só o Mini Chat (textos
  fixos, perguntas de contato, e-mail do lead) e o idioma das perguntas geradas por
  IA. `minichat_config.template` (`whatsapp`|`email`, padrão `whatsapp`) +
  `bg_color`/`accent_color` (só `#hex`, validado em `cleanHexColor`) controlam o
  visual "Estilo E-mail" (inspirado no mini chat da CAA Renovations).
- No modo "E-mail" as perguntas de contato são nome, **e-mail**, telefone e data de
  nascimento ("pra gente te mandar um brinde no seu aniversário 🎁" / em inglês "so we
  can send you a little gift on your birthday 🎁"). O e-mail vai pro CRM
  (`customers.email`). No modo WhatsApp a pergunta de nascimento continua a de sempre.

## Detecção de framework: TanStack Start novo (Lovable)

A versão nova do TanStack Start (a do Lovable) NÃO tem `app.config.ts` — tem
`vite.config.ts` com o plugin `tanstackStart`. Por isso "tem vite.config" não prova
que é SPA Vite. `detectRepoFramework()` reconhece o Start por: rotas TanStack + (sem
`index.html` na raiz OU `src/start|server|client.ts`). Foi assim que o `vercel.json`
da CAA Renovations virou um genérico de Vite (25/08) — mesmo erro da Lervet (regra 6).

## Telefones do CRM: 9 do celular e repetidos

- Ao salvar contatos (lista colada no Admin, importação/adição do produtor), celular
  brasileiro antigo sem o 9 ganha o 9 (`addMissingNinthDigit()`): só com DDD válido +
  8 dígitos começando com 6–9. Fixo (2–5) nunca muda. Produtor com Mini Chat em
  inglês (`minichat_config.language === "en"`) nunca passa por essa regra — número
  estrangeiro de 10 dígitos pode parecer celular brasileiro.
- Repetido é comparado por `phoneMatchKey()` (ignora formatação, 55 e o 9 faltando)
  — o número é gravado como veio (já com o 9 corrigido), a chave é só pra comparar.
- Contatos que já estavam sem o 9: botão "Corrigir agora" em Clientes do produtor
  (`/customers/fix-phones`). Nunca apaga contato; se a mesma pessoa já existe com o 9,
  não mexe em nenhum dos dois e só avisa.

## Aniversário e telefone no Mini Chat / CRM

- O `minichat.html` aceita a data de nascimento em qualquer formato ("09/08/2000",
  "09082000", "9-8-00", "090800"), mostra já ajustada na bolha (e na mensagem final)
  e manda pro CRM em `AAAA-MM-DD`. Data impossível pede de novo; depois de 3 tentativas
  aceita como veio (nunca trava o chat). Telefone igual: aceita parênteses/traço/+55,
  mostra "(24) 99982-9182" e manda só os dígitos.
- `/api/leads/create`: quando a pessoa JÁ existe no CRM (ex: veio de lista do Google
  Ads), completa o que estava faltando (aniversário, e-mail, nome no lugar de
  "Contato Google N") — nunca sobrescreve dado que já existia. Antes descartava tudo e
  só contava "veio 2x", o que gerava "aniversário não informado" pra quem respondeu.

## Mini Chat PRÓPRIO do site conta como conectado

Se o nosso Mini Chat não está no ar mas o repositório do cliente já tem um mini chat
próprio (`detectOwnMinichat()`: caminho com cara de chat/quiz + lista de
perguntas/opções no conteúdo — ex: `public/minichat/index.html` da CAA),
`verifyMinichatLive()` devolve `status: "proprio"` e o card "Mini Chat no site" /
checklist ficam verdes, sem pedir instalação (pedido do Thomas). Sempre com aviso
claro quando esse chat NÃO manda o contato pro JosephPay (só o `sensor.js` não conta).
Link interno pro chat próprio deixa de ser pendência em "Botões do site"; o job
automático nunca reinstala o nosso por cima de um próprio. wa.me continua pendência
(regra 3).

## Visual: estilo Apple + vidro fosco (glassmorphism)

Pedido do Thomas: telas limpas, estilo Apple, sempre com vidro fosco. Use os helpers
`glassCard()`, `glassInset` e `pillBtn()` (`index.html`, junto das cores). Padrão de
card: UM status em linguagem simples no topo (ícone + título + 1 frase), UMA ação
principal conforme o status, ações secundárias como links pequenos, e tudo que é
técnico/raro escondido em "Detalhes" — sem nunca remover função (regra do Admin).
Primeiro card nesse padrão: "Mini Chat no site" (`MinichatRepoAdmin`).
Desde 02/10 o app INTEIRO usa vidro: `glassSurface` (cards/KPIs, sem padding — troca
só o fundo), `glassSheet` (folhas que sobem de baixo) e `APP_BG` (fundo com brilho
dourado sutil, é o que faz o vidro aparecer). Nunca volte a usar `background:CARD`
sólido em card novo; a área de Disparos (`.crm-v9`) tem o mesmo vidro em CSS.

## Ler o mini chat que já existe no site do cliente (padrão)

Ao abrir os cards "Mini Chat" e "Perguntas do Mini Chat", o Admin chama sozinho
`/minichat/import-questions-from-repo` (`importMinichatFromRepo()`, cache 30 min por
repo). `findMinichatSources()` acha o mini chat em QUALQUER repositório: primeiro pelo
nome do arquivo (minichat/chat/quiz/diagnóstico…), senão varrendo até 40 arquivos de
código atrás de uma lista de perguntas com opções. Perguntas vêm pela IA (texto exato,
sem traduzir); e-mail, WhatsApp, nome, cores e idioma vêm de `extractMinichatSettings()`
(sem IA). Só PREENCHE a tela — vira definitivo ao clicar Salvar. Perguntas só são
puxadas se o cliente não tem perguntas próprias salvas; destino, idioma, visual, e-mail e
WhatsApp só são preenchidos em Mini Chat nunca configurado (sem WhatsApp nem e-mail
salvos) — produtor que já usa nunca tem isso trocado.


## Ativação robusta: verde só com prova real

- `getRepoDeployStatus()` lê do GitHub o resultado da última publicação da Vercel
  (ok / publicando / bloqueado / falhou) — card Vercel e "Testar tudo". "Bloqueado"
  = a Vercel (plano Hobby) recusou o autor do commit; resolve com Redeploy no painel
  da Vercel pelo dono. Commit feito por fora do JosephPay (ex: sessão do Claude com
  co-autor) cai nisso — visto na CAA em 02/10.
- `getSensorStatus()`: sensor aparece no HTML do site? Visitas do SITE (não só da
  página do mini chat) chegando nos últimos 14 dias? A CAA tinha o sensor só dentro
  do mini chat antigo e o card ficava verde.
- Instalação do sensor: sempre que houver `</head>`/`</Head>`/`</body>` (HTML ou JSX)
  a `<script>` vai ali; o carregador em JS só como último recurso e protegido com
  `typeof document !== "undefined"` — sem isso derrubava site com servidor próprio.
- `detectHosting()` identifica Vercel/Netlify/Cloudflare/etc. pelos cabeçalhos.
- `/activation-test` ("Testar tudo" no checklist): site no ar, publicação, sensor,
  Mini Chat no site, destino e envio de e-mail — só leitura.
- "E-mail pra disparos" é etapa opcional (não conta no X de Y).
- Visual: todos os cards da Ativação usam `glassCard()`.

## Interessado entra no CRM sempre (qualquer modo)

O `minichat.html` chama `sendLeadToCRM()` assim que a pessoa termina o diagnóstico
(tela final), em TODO modo — WhatsApp, E-mail ou Ambos. Antes, no modo WhatsApp, só
entrava se a pessoa tocasse no botão verde. `leadSavedToCRM` garante uma vez só (o
botão depois não conta de novo). A mensagem do WhatsApp não muda. No Admin, a lista
de produtores (`ClientesAdmin`) se atualiza sozinha ao voltar pro app e a cada 90s,
e "Clientes do produtor" recarrega quando o número de interessados muda.

## GTM: botões de WhatsApp abrem o Mini Chat (sites sem GitHub)

`buildMinichatGtmTag()` + `/gtm/install-minichat` | `/gtm/minichat-status` |
`/gtm/remove-minichat` (card "Botões do site (GTM)"). Exceção controlada da regra 7:
a troca acontece no navegador do visitante, instalada SÓ por clique do admin, e:
só troca link de WhatsApp do número do produtor (últimos 8 dígitos) ou sem número;
nunca roda em página com cara de mini chat/quiz do próprio site (evita o loop da
Lervet); respeita `data-jp-keep`; nunca publica se o GTM tiver alteração pendente de
outra pessoa (`gtmForeignPendingChanges`). Status = tag no gtm.js PUBLICADO + GTM no
HTML do site (prova real, regra 4). Reaproveita o trigger "JosephPay — Todas as
páginas" (antes o sensor criava um duplicado a cada clique).

## Consertar vercel.json (site com servidor próprio) e avisos no celular

- `/github/vercel-fix` (card Vercel): em `unknownFramework` com a config genérica de
  Vite, tira só as chaves genéricas (`buildCommand`/`outputDirectory`/`framework:"vite"`
  /rewrite pra index.html), põe `framework: null` e mantém o resto (ex: `redirects`).
  Prévia antes/depois; grava só no clique e só se o arquivo não mudou desde a prévia.
- `runSiteHealthMonitor()` a cada 30 min, só sites na Vercel: publicação falhou/
  bloqueou, site fora do ar, Mini Chat parou (só se estava funcionando). Push pro admin
  SÓ na mudança (quebrou ⚠️ / voltou ✓), nunca repete; a 1ª rodada após o servidor
  ligar só anota. Teste: "enviar teste" no checklist (`/api/admin/alerts/test`).

## Métricas do Mini Chat (sub-aba "📊 Mini Chat" do produtor)

- `GET /api/admin/producers/:id/minichat/insights?dias=7|30|90|365` calcula tudo a partir de
  `minichat_sessions.answers` (vale pra todo produtor, pt/en, WhatsApp/e-mail, inclusive histórico):
  % de cada resposta (agrupado pelo TEXTO da pergunta, com ↑↓ vs período anterior), funil,
  desistência por pergunta (⚠️ + "✨ Sugerir outra pergunta" via IA — só sugere, nunca salva),
  cruzamentos (1ª pergunta x as outras), Google Ads x orgânico, 🔥 quentes, horários, resumo IA.
- Origem: `minichat.html` manda `origem` no track-progress (`getOrigem()`: gclid/gbraid/wbraid,
  utm de anúncio Google, `jp_ads=1`/`jp_src` que o `sensor.js` acrescenta nos links com "minichat").
- 🔥 Quente = resposta tipo "Quanto antes"/"Este mês"/"As soon as possible" (`MC_QUENTE_RE`).
  `leads/create` recebe `visitor_id` e liga a conversa ao contato (`linkMinichatSessionToCustomer`,
  depois da resposta, nunca bloqueia) + push pro admin uma vez.
- Colunas `origem`, `customer_id`, `quente` (migration_v44) são opcionais: sem o SQL tudo funciona,
  só sem Ads x orgânico/aviso 🔥. Relatório mensal ganha `publico` ("O que seu público respondeu").
- Nada das telas antigas foi removido — é só aba/seção nova (pedido do Thomas).

## Perguntas do Mini Chat: "📋 Copiar prompt" é a ação principal

Pedido do Thomas: ele usa outra ferramenta (social media) que já conhece cada cliente. Ação
principal do card = "📋 Copiar prompt" (idioma segue `minichat_config.language`) + "📥 Colar
resposta" (JSON). "✨ Gerar com IA" continua existindo, só foi pra "Mais opções" (nunca remover).

## Aviso pro xPosts quando o Mini Chat capta um contato

- `/api/leads/create` → `avisarXposts()` (depois de responder, nunca muda o Mini Chat): POST em
  `XPOSTS_LEAD_URL` (padrão `https://socialmediax.vercel.app/api/lead-minichat`) com `x-xposts-key:
  XPOSTS_KEY` (só variável de ambiente do servidor) e `{ cliente, id, nome, contato, mensagem, quando }`.
  `cliente` = token do xPosts do produtor (`minichat_config.xposts_token`, card "xPosts (tráfego)" na
  Ativação, aceita o link `/f/<id>/<token>`); `id` = `customers.id` (o xPosts não duplica);
  `mensagem` = respostas do Mini Chat sem os dados de contato.
- Resposta ≠ 200 → fica em `xposts_avisos` (migration_v45) e `reenviarAvisosXposts()` tenta de novo a
  cada 5 min com espera crescente (até 6 h, 40 tentativas). Sem a tabela, o reenvio fica só na memória.
- O PATCH do Mini Chat só MANTÉM `xposts_token` (quem grava é `/xposts`), pra salvar o Mini Chat não apagar o token.

## Mini Chat em espanhol (10/10, DISASTEX)

- `minichat_config.language` aceita `pt` | `en` | `es` (`cleanMinichatLang()` no servidor, `mcLang()` no
  Admin). `I18N.es` no `minichat.html`: data dia/mês, telefone livre (igual ao inglês). Os textos de `pt`
  continuam intocados.
- Espanhol também: nunca passa pela regra do 9 (`ownerUsesBrPhones` só vale pra `pt`), métricas no
  horário de Nova York, e-mail do lead em espanhol, IA gera perguntas em espanhol (`minichatLangInstruction`),
  🔥 quente reconhece "Lo antes posible"/"Cuanto antes".

## Site com Vercel em OUTRA conta (publicação pelo GitHub Actions)

Quando a Vercel do cliente não está ligada direto ao GitHub, quem publica é uma rotina do GitHub Actions
com a chave da Vercel do cliente (segredo `VERCEL_TOKEN`) — ex: DISASTEX (`WeNovarks/pixel-perfect-match`).
`getRepoDeployStatus()` cai em `getActionsDeployStatus()` (rotina com "vercel" no nome/arquivo). Se a
rotina "passou" mas pulou o passo de publicar (sem a chave), conta como **falhou** — o site no ar não mudou.
O JosephPay continua só gravando no GitHub; nunca precisa de acesso à Vercel do cliente.

## Botão direto pro Mini Chat conta como "no ar" (qualquer tipo de site)

Botão com href `josephpay.com/minichat.html?uid=<id>` é o jeito universal (Lovable/TanStack Start, Next,
Vite, HTML, qualquer hospedagem) — não depende de caminho nem de redirecionamento. `verifyMinichatLive()`
testa o caminho e, se não abrir, roda `checkDirectMinichatButton()`: procura o link no HTML publicado e nos
JS que ele carrega (`<script src>`/modulepreload, mesma origem, até 25). Achou → `status:"ok"`,
`method:"botao"`. Não está no site mas está no código (`scanRepoJsxLinks`) → `status:"nao_publicado"`
("Falta publicar" — publicação bloqueada/pendente, não precisa reinstalar). Checklist: "Vercel preparado"
conta como feito quando o Mini Chat está confirmado no site (o vercel.json só importa pro redirecionamento).
Visto na DISASTEX (10/10): botão certo no ar e o card dizia "Ainda não está no ar".

## Página de obrigado / grupo depois do envio (opcional, por produtor)

Card Mini Chat → "Página de obrigado / grupo depois do envio?" Não (padrão) | Sim + link
(`minichat_config.thanks_enabled` / `thanks_link`, só http(s) — `cleanHttpLink`). Com "Sim", o
`minichat.html` (`armThanksRedirect()`) leva a pessoa pro link quando ela volta do app de e-mail ou do
WhatsApp (ou 6 s depois, no computador), com `?lang=en|es` se o Mini Chat não for em português. Com "Não"
nada muda, e o envio em si (e-mail/WhatsApp) é sempre o mesmo. É separado do "Redirecionamento final"
(`redirect_link`, que troca o botão do WhatsApp). A página fica no site do cliente — ex: DISASTEX
`/gracias` (¡Felicidades! + botão pro grupo do WhatsApp).

