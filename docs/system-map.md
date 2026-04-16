# JosephPay — Mapa do Sistema

## Visão Geral

JosephPay é uma plataforma SaaS brasileira de pagamentos digitais para infoprodutores. Permite que produtores vendam produtos digitais, gerenciem assinaturas, afiliados, clientes e recebam via PIX/Cartão usando a API Asaas.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (Vercel)                                          │
│  josephpay.vercel.app                                       │
│  index.html — React + Babel standalone (SPA de arquivo único)│
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

**Acesso:**
- `https://josephpay.vercel.app` → produção
- `file:///...index.html` → local (modo demo sem backend)

**Fluxo de autenticação:**
1. Usuário clica em tipo de conta (Admin / Produtor / Afiliado)
2. Insere e-mail + senha
3. `_sb.auth.signInWithPassword()` → Supabase Auth
4. JWT armazenado na sessão Supabase (auto-refresh)
5. Todas as chamadas ao Railway incluem `Authorization: Bearer <JWT>`

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
- `aggregateSales(sales, period, now)` — agrega array de vendas por período para gráficos

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

**Middleware:** `requireAuth` — verifica JWT Supabase em todas as rotas protegidas

#### Rotas disponíveis

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/health` | ✗ | Status do servidor e serviços |
| POST | `/api/asaas/checkout` | ✓ | Cria cobrança no Asaas |
| POST | `/api/asaas/withdraw` | ✓ | Saque via PIX |
| POST | `/api/asaas/webhook` | ✗ | Recebe eventos Asaas |
| GET | `/api/asaas/balance` | ✓ | Saldo disponível na conta |
| POST | `/api/chat` | ✓ | Chat IA via Anthropic |
| GET | `/api/whatsapp/status` | ✓ | Status WhatsApp (Evolution API) |
| POST | `/api/whatsapp/send` | ✓ | Envia mensagem WhatsApp |
| POST | `/api/whatsapp/webhook` | ✗ | Recebe mensagens WhatsApp |
| GET | `/api/dashboard/kpis` | ✓ | KPIs do produtor autenticado |
| GET | `/api/admin/kpis` | ✓ | KPIs globais da plataforma |
| GET | `/api/admin/sales` | ✓ | Vendas de todos os produtores |
| GET | `/api/admin/clients` | ✓ | Lista de produtores cadastrados |
| GET | `/api/admin/chart` | ✓ | Dados de gráfico (admin) |

**Variáveis de ambiente no Railway:**
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY  ← nunca exposta ao browser
ASAAS_API_KEY
ASAAS_API_URL
ANTHROPIC_API_KEY
EVOLUTION_API_URL
EVOLUTION_API_KEY
EVOLUTION_INSTANCE
PORT
FRONTEND_ORIGIN
```

---

### 3. Banco de Dados — Supabase

**Projeto:** `ljpjadwvqocatnqjvuvk.supabase.co`  
**Schema:** `supabase/schema.sql`

#### Tabelas

| Tabela | Descrição | RLS |
|---|---|---|
| `profiles` | Usuários da plataforma (produtores, admin) | `owner_id = auth.uid()` |
| `products` | Produtos digitais dos produtores | `owner_id = auth.uid()` |
| `customers` | Compradores finais dos produtos | `owner_id = auth.uid()` |
| `sales` | Transações de venda | `owner_id = auth.uid()` |
| `subscriptions` | Assinaturas recorrentes | `owner_id = auth.uid()` |
| `affiliates` | Afiliados dos produtos | `owner_id = auth.uid()` |
| `coproducers` | Coprodutores | `owner_id = auth.uid()` |
| `messages` | Histórico de mensagens WhatsApp | `owner_id = auth.uid()` |
| `withdrawals` | Histórico de saques | `owner_id = auth.uid()` |

**Trigger automático:** `handle_new_user()` — cria registro em `profiles` ao criar usuário no Supabase Auth.

**Acesso:**
- **Browser (frontend):** Usa `SUPABASE_ANON` + JWT do usuário → RLS filtra automaticamente `owner_id = auth.uid()`
- **Railway (backend):** Usa `SUPABASE_SERVICE_ROLE_KEY` → bypass RLS → acesso a todos os dados

---

### 4. Pagamentos — Asaas

**Ambiente atual:** Sandbox (`https://sandbox.asaas.com/api/v3`)  
**Produção:** `https://api.asaas.com/api/v3` (trocar `ASAAS_API_URL` no Railway)

**Fluxo de checkout:**
1. Frontend → `POST /api/asaas/checkout` com `{amount, description, billingType, customer}`
2. Railway cria/busca customer no Asaas
3. Railway cria payment no Asaas
4. Railway salva venda em `sales` com status `pendente`
5. Retorna `{paymentUrl, chargeId}` ao frontend
6. Asaas notifica via webhook → Railway atualiza `sales.status = 'pago'`

**Fluxo de saque:**
1. Frontend → `POST /api/asaas/withdraw` com `{amount, pixKey, pixKeyType}`
2. Railway cria transferência PIX no Asaas
3. Salva em `withdrawals` com status `processando`
4. Webhook `TRANSFER_DONE` atualiza para `concluido`

---

### 5. Chat IA — Anthropic

**Modelo:** `claude-haiku-4-5-20251001`  
**Rota:** `POST /api/chat`

**System prompt:** Assistente especializado em marketing digital e vendas de infoprodutos. Responde em português brasileiro.

---

### 6. WhatsApp — Evolution API

**Status:** Configuração pendente (variáveis de ambiente com placeholders)

**Para ativar:**
1. Instalar Evolution API em servidor próprio ou usar cloud
2. Criar instância e escanear QR code
3. Atualizar `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` no Railway
4. Configurar webhook `https://josephpay-production.up.railway.app/api/whatsapp/webhook` no painel Evolution

---

## Fluxo de Dados por Aba

### Admin — Dashboard
```
/api/admin/kpis → receita, taxas, transações, produtores, afiliados, MRR
/api/admin/sales?limit=4 → últimas 4 vendas da plataforma
/api/admin/clients → lista de produtores com volume e taxas
/api/admin/chart?period=X → dados para gráfico de área
```

### Admin — Vendas
```
/api/admin/sales?limit=100 → todas as vendas (filtrável por produtor)
```

### Admin — Clientes (Produtores)
```
/api/admin/clients → lista com volume e taxas por produtor
/api/admin/sales?owner=UUID → vendas de um produtor específico (perfil)
```

### Produtor — Início (Dashboard)
```
/api/dashboard/kpis → receitaMes, vendasHoje, assinaturasAtivas
Supabase: sales (últimas 3) + customers (total)
Supabase: sales (agregado por período para gráfico)
```

### Produtor — Produtos
```
Supabase: products (lista do produtor)
Supabase: sales (receita/vendas do mês por produto)
Supabase: subscriptions (contagem ativas por produto)
Supabase: affiliates (contagem ativos por produto)
```

### Produtor — Clientes
```
Supabase: customers (lista com sales e aniversários)
```

### Produtor — Sacar
```
/api/asaas/balance → saldo disponível
/api/asaas/withdraw → solicita saque PIX
```

---

## Status de Implementação

| Funcionalidade | Status | Notas |
|---|---|---|
| Login / Auth | ✅ Funcionando | Supabase Auth + localStorage demo |
| Dashboard Produtor | ✅ Dados reais | KPIs via Railway |
| Dashboard Admin | ✅ Dados reais | Todos os produtores via service role |
| Vendas Produtor | ✅ Dados reais | Supabase direto |
| Vendas Admin | ✅ Dados reais | /api/admin/sales |
| Assinaturas | ✅ Dados reais | Supabase direto |
| Produtos | ✅ Dados reais | Supabase com agregações |
| Afiliados | ✅ Dados reais | Supabase direto |
| Clientes (Painel) | ✅ Dados reais | Supabase com joins |
| Saque | ✅ Funcional | Asaas sandbox |
| Checkout | ✅ Funcional | Asaas sandbox |
| Chat IA | ✅ Funcional | Anthropic claude-haiku |
| WhatsApp | ⚠️ Pendente | Aguardando configuração Evolution API |
| Analytics Visitantes | 🔜 Em breve | Sem infraestrutura de analytics ainda |
| Gráfico de Receita | ✅ Dados reais | Agrega vendas do Supabase |

---

## Para Produção

1. **Trocar sandbox Asaas por produção:**
   - Alterar `ASAAS_API_URL` no Railway: `https://api.asaas.com/api/v3`
   - Usar chave de produção em `ASAAS_API_KEY`

2. **Configurar WhatsApp:**
   - Instalar Evolution API
   - Preencher `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`
   - Escanear QR code para conectar número

3. **Configurar webhooks Asaas:**
   - No painel Asaas → Configurações → Webhooks
   - URL: `https://josephpay-production.up.railway.app/api/asaas/webhook`

4. **Domínio customizado:**
   - Vercel: adicionar domínio customizado em Settings → Domains
   - Atualizar `FRONTEND_ORIGIN` no Railway com o novo domínio
