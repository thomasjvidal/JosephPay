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
