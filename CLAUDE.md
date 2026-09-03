# JosephPay — Regras para o Claude

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
