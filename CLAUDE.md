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

1. **Nunca criar um arquivo novo fora de `public/` num projeto com build**
   (tem `package.json` → é Vite/Next/CRA/etc). Só o que está em `public/` é
   copiado pro deploy final — qualquer outro arquivo novo commitado "funciona"
   no GitHub mas nunca aparece no site publicado. Use `detectRepoFramework()`
   / `ensureVercelConfig()` (`api/server.js`) antes de criar qualquer arquivo
   novo num repo de cliente, e prefixe o caminho com `public/` quando for
   projeto com build.
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

Antes de fechar qualquer tarefa que mexe nesses endpoints, considere rodar
(ou sugerir ao Thomas) a mesma correção nos produtores que já existem, não só
no que motivou a mudança — o objetivo é o Admin inteiro ficar consistente,
não só o caso que gerou a reclamação.
