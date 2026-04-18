# JosephPay — Mapa do Sistema (SSOT)

> **Fonte de verdade absoluta.** Qualquer IA ou dev que mexer neste sistema deve ler este arquivo primeiro.  
> Última atualização: 2026-04-17

---

## Visão Geral

JosephPay é uma plataforma SaaS brasileira de pagamentos digitais para infoprodutores.  
1 conta Asaas (do Thomas) → múltiplos produtores → identificação via `owner_id` no Supabase.

**Modelo de taxa (Opção B):**  
- Produtor define preço base → sistema embute 0,99% → cliente paga `base * 1.0099`  
- `platform_fee` = o que foi embutido (extraído via `gross - gross/1.0099`)  
- `producer_amount` = `net_amount - platform_fee` (produtor recebe o valor base exato)

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (Vercel)                                          │
│  josephpay.vercel.app                                       │
│  index.html — React 18 + Babel standalone (SPA única)       │
│  CDNs: React 18, Recharts, Supabase JS, Babel              │
└────────────────────┬────────────────────────────────────────┘
                     │  Fetch (REST JSON)
          ┌──────────▼──────────┐        ┌──────────────────┐
          │  BACKEND (Railway)  │        │  SUPABASE (DB)   │
          │  josephpay-production│◄──────►│  ljpjadwvqocatnqj│
          │  .up.railway.app    │        │  .supabase.co    │
          │  Express.js 4       │        │  PostgreSQL + RLS │
          └──────────┬──────────┘        └──────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌─────────┐  ┌─────────┐  ┌──────────────┐
   │  ASAAS  │  │ANTHROPIC│  │ EVOLUTION API│
   │ (Pagtos)│  │(Chat IA)│  │  (WhatsApp)  │
   └─────────┘  └─────────┘  └──────────────┘
```

---

## Camadas

### 1. Frontend — `index.html`

**Tecnologia:** React 18 (UMD), Babel Standalone, Recharts, Supabase JS v2

**Constantes críticas:**
```js
const SUPABASE_URL  = "https://ljpjadwvqocatnqjvuvk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiI...";  // chave pública — OK no browser
const RAILWAY       = "https://josephpay-production.up.railway.app";
```

**Helpers globais:**
- `fmtBRL(v)` — formata número como `R$ 1.234,56`
- `getToken()` — retorna JWT da sessão Supabase atual
- `apiCall(path, opts)` — fetch autenticado para Railway
- `aggregateSales(sales, period, now)` — agrega vendas por período para gráficos

**Painéis:**
| Painel | Componente raiz | Quem acessa |
|---|---|---|
| Admin | `AdminPanel` | role = "admin" |
| Produtor | `ClientPanel` | role = "client" |
| Afiliado | `ClientPanel` | role = "afiliado" |

---

### 2. Backend — `api/server.js`

**Tecnologia:** Express.js 4, Node.js ≥18, Axios, Supabase JS v2 (service role)  
**Deploy:** Railway → auto-deploy ao push em `main`  
**Middleware:** `requireAuth` — verifica JWT Supabase + upsert do profile (fire-and-forget)

#### Rotas completas

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/health` | ✗ | Status do servidor e serviços |
| POST | `/api/products/create` | ✓ | Cria produto + link de pagamento no Asaas (BLOQUEIA se Asaas falhar) |
| GET | `/api/products` | ✓ | Lista produtos do produtor com stats do mês |
| DELETE | `/api/products/:id` | ✓ | Remove produto (só o dono) |
| POST | `/api/asaas/checkout` | ✓ | Cria cobrança avulsa no Asaas |
| POST | `/api/asaas/withdraw` | ✓ | Saque via PIX |
| POST | `/api/asaas/webhook` | ✗ | Recebe eventos Asaas (PAYMENT_RECEIVED, TRANSFER_DONE, etc.) |
| GET | `/api/asaas/balance` | ✓ | Saldo disponível na conta Asaas |
| POST | `/api/chat` | ✓ | Chat IA via Anthropic Claude Haiku |
| GET | `/api/whatsapp/status` | ✓ | Status da instância WhatsApp |
| POST | `/api/whatsapp/send` | ✓ | Envia mensagem WhatsApp |
| POST | `/api/whatsapp/webhook` | ✗ | Recebe mensagens WhatsApp inbound |
| GET | `/api/dashboard/kpis` | ✓ | KPIs do produtor (bruto, líquido, taxas) |
| GET | `/api/dashboard/chart?period=X` | ✓ | Dados de gráfico do produtor |
| GET | `/api/admin/kpis` | ✓ | KPIs globais da plataforma |
| GET | `/api/admin/sales?limit=N&owner=UUID` | ✓ | Vendas de todos os produtores |
| GET | `/api/admin/clients` | ✓ | Lista de produtores com volume e taxas |
| GET | `/api/admin/chart?period=X&owner=UUID` | ✓ | Dados de gráfico (admin) |
| GET | `/api/ledger/balance` | ✓ | Saldo interno do produtor (produtor_amount - saques) |
| POST | `/api/sync/history` | ✓ | Importa pagamentos históricos do Asaas com dados financeiros completos |

**Variáveis de ambiente no Railway:**
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY  ← nunca exposta ao browser
ASAAS_API_KEY
ASAAS_API_URL              ← sandbox ou produção
ANTHROPIC_API_KEY
EVOLUTION_API_URL          ← ⚠️ ainda placeholder: https://evo.seudominio.com
EVOLUTION_API_KEY
EVOLUTION_INSTANCE
PORT
FRONTEND_ORIGIN
```

---

### 3. Banco de Dados — Supabase

**Projeto:** `ljpjadwvqocatnqjvuvk.supabase.co`  
**Migrations aplicadas:**
- `supabase/schema.sql` — schema base
- `supabase/migration_v2.sql` — ✅ APLICADA: `asaas_link_id`, `asaas_price` em products; `platform_fee`, `producer_amount` em sales
- `supabase/migration_v3.sql` — ⚠️ APLICAR: campos financeiros completos em sales + `asaas_customer_id` em customers

#### Tabelas e colunas críticas

**`products`** (migration_v2 required):
- `asaas_link_id` — ID do payment link no Asaas (chave de lookup do webhook)
- `asaas_price` — preço com 0.99% embutido (o que o cliente paga)
- `url` — URL copiável do checkout Asaas

**`sales`** (migration_v2 + v3 required):
- `asaas_id` — ID da cobrança no Asaas (anti-duplicata)
- `gross_amount` — valor bruto pago pelo cliente
- `net_amount` — após taxa do gateway Asaas
- `asaas_fee` — taxa cobrada pelo Asaas
- `platform_fee` — taxa JosephPay (0.99% do gross)
- `producer_amount` — valor líquido final do produtor
- `installment_count` — número de parcelas
- `billing_type` — PIX, CREDIT_CARD, BOLETO
- `payment_date` — data real do pagamento (usada para KPIs, não `created_at`)

**`customers`** (migration_v3 required):
- `asaas_customer_id` — ID único do cliente no Asaas (deduplicação — PIX pode não trazer email)

**Trigger automático:** `handle_new_user()` — cria `profiles` ao signup no Auth.

---

### 4. Fluxo de Pagamento (SSOT do dinheiro)

```
[1] Produtor cria produto
     → POST /api/products/create
     → Asaas cria /paymentLinks com externalReference=owner_{uid}
     → Se Asaas falhar → ERRO 400, produto NÃO salvo
     → Supabase products: name + price + asaas_link_id + asaas_price + url + owner_id

[2] Cliente acessa o link e paga
     → Asaas processa o pagamento
     → Asaas dispara POST /api/asaas/webhook (PAYMENT_RECEIVED ou PAYMENT_CONFIRMED)

[3] Webhook processa (3 casos):
     Caso 1: asaas_id já existe em sales → só atualiza status/valores (anti-duplicata)
     Caso 2: payment.paymentLink → busca product por asaas_link_id → insere em sales
     Caso 3: fallback externalReference → extrai owner_id → insere em sales sem product_id

[4] Dashboard lê Supabase (não o Asaas diretamente)
     → /api/dashboard/kpis filtra sales por owner_id + payment_date do mês
     → Retorna receitaBrutaMes, receitaLiquidaMes, taxasAsaasMes, taxaPlataformaMes
```

---

### 5. Chat IA — Anthropic

**Modelo:** `claude-haiku-4-5-20251001`  
**Rota:** `POST /api/chat`  
**System prompt:** Assistente de marketing digital para infoprodutores, PT-BR.

---

### 6. WhatsApp — Evolution API

**Status atual:** ❌ Não configurado — `EVOLUTION_API_URL` é placeholder (`https://evo.seudominio.com`)

**Para ativar:**
1. Instalar Evolution API em servidor próprio ou usar cloud
2. Criar instância e escanear QR code
3. Atualizar `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` no Railway
4. Configurar webhook `https://josephpay-production.up.railway.app/api/whatsapp/webhook` no painel Evolution

---

## Status Real de Implementação

| Funcionalidade | Status | Notas |
|---|---|---|
| Login / Auth | ✅ Funcionando | Supabase Auth + trigger profile |
| Criação de produto com link real | ✅ Corrigido | Bloqueia se Asaas falhar; logs completos |
| Delete de produto | ✅ Implementado | DELETE /api/products/:id + botão no frontend |
| Webhook → venda com dono | ✅ Corrigido | 3 casos + anti-duplicata + externalReference |
| Modelo financeiro (Opção B) | ✅ Corrigido | producer_amount = product.price (valor base exato); Case 3 usa gross/1.0099 |
| Dados financeiros completos | ✅ Implementado | gross/net/asaas_fee/platform_fee/producer_amount |
| Dashboard KPIs (bruto + líquido) | ✅ Corrigido | Usa payment_date; retorna 6 campos financeiros |
| Gráfico "hoje" | ✅ Corrigido | 8 slots de 3h (00h-21h), dia todo |
| Gráfico "trimestre" | ✅ Corrigido | Trimestre calendário (Q1=Jan, Q2=Abr, etc.) |
| Assinaturas no webhook | ✅ Implementado | Upsert em subscriptions quando payment.subscription presente |
| Sync histórico Asaas | ✅ Implementado | /api/sync/history com dados financeiros completos |
| Saldo interno (ledger) | ✅ Implementado | /api/ledger/balance usa producer_amount |
| Vendas / Assinaturas / Afiliados | ✅ Dados reais | Supabase direto |
| Clientes (deduplicação) | ✅ Corrigido | upsert via asaas_customer_id |
| Clientes (aba UI) | ⚠️ Depende de migration_v3 | Sem migration_v3, asaas_customer_id não existe |
| Clique venda → cliente específico | ✅ Implementado | onNav("clientes", customerId) abre cliente direto |
| Saque PIX | ✅ Funcional | Componente Sacar + backend ledger; botão no dashboard |
| Chat IA | ✅ Funcional | Anthropic Claude Haiku |
| WhatsApp | ❌ Não configurado | EVOLUTION_API_URL é placeholder |
| Analytics Visitantes | 🔜 Futuro | Sem infraestrutura ainda |

---

## Checklist para produção

1. **Aplicar migration_v3.sql no Supabase** ← CRÍTICO (sem isso, campos financeiros ficam NULL)
2. **Configurar webhook no painel Asaas Sandbox:**
   - URL: `https://josephpay-production.up.railway.app/api/asaas/webhook`
3. **Testar fluxo completo:**
   - Criar produto → ver log `[products/create] resposta Asaas: {id, url}`
   - Pagar via link (cartão sandbox: `5500000000000004`)
   - Ver log `[webhook] produto "X" pago — bruto R$X, produtor R$Y`
   - Verificar tabela `sales` no Supabase
   - Verificar dashboard (receita ≠ zero)
4. **Trocar sandbox por produção quando pronto:**
   - `ASAAS_API_URL` → `https://api.asaas.com/api/v3`
   - `ASAAS_API_KEY` → chave de produção
5. **Configurar WhatsApp:**
   - `EVOLUTION_API_URL` → URL real da Evolution API
6. **Domínio customizado:**
   - Vercel Settings → Domains
   - Atualizar `FRONTEND_ORIGIN` no Railway
