/**
 * JosephPay — API Server
 * Express.js — proxy seguro para Asaas, Anthropic e WhatsApp (Evolution API)
 *
 * Rodar:  cd api && npm install && node server.js
 * Porta:  3001 (o front em index.html aponta para http://localhost:3001)
 */

const express    = require("express");
const cors       = require("cors");
const axios      = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
app.use(express.json());

// ── Supabase Admin Client (service role — NUNCA exponha ao browser) ──────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Asaas base URL ─────────────────────────────────────────────────────────
// Sandbox: https://sandbox.asaas.com/api/v3
// Produção: https://api.asaas.com/api/v3
const ASAAS_URL = process.env.ASAAS_API_URL || "https://sandbox.asaas.com/api/v3";

const asaas = axios.create({
  baseURL: ASAAS_URL,
  headers: { access_token: process.env.ASAAS_API_KEY, "Content-Type": "application/json" },
});

// ── Middleware: verifica JWT do Supabase em rotas protegidas ─────────────────
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Token ausente" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Token inválido" });
  req.user = user;
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — ASAAS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/asaas/checkout
 * Cria um link de pagamento no Asaas
 * Body: { productId, customerId?, amount, description, billingType }
 */
app.post("/api/asaas/checkout", requireAuth, async (req, res) => {
  try {
    const { productId, amount, description, billingType = "UNDEFINED", customer } = req.body;

    // Cria ou busca customer no Asaas
    let asaasCustomerId;
    if (customer?.email) {
      const search = await asaas.get(`/customers?email=${encodeURIComponent(customer.email)}`);
      if (search.data.totalCount > 0) {
        asaasCustomerId = search.data.data[0].id;
      } else {
        const created = await asaas.post("/customers", {
          name: customer.name || customer.email,
          email: customer.email,
          phone: customer.phone,
        });
        asaasCustomerId = created.data.id;
      }
    }

    // Cria cobrança
    const charge = await asaas.post("/payments", {
      customer: asaasCustomerId,
      billingType,
      value: amount,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      description: description || "JosephPay",
    });

    // Salva venda no Supabase como pendente
    await supabase.from("sales").insert({
      product_id:  productId,
      owner_id:    req.user.id,
      amount,
      status:      "pendente",
      asaas_id:    charge.data.id,
    });

    res.json({ paymentUrl: charge.data.invoiceUrl, chargeId: charge.data.id });
  } catch (err) {
    console.error("[asaas/checkout]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.description || err.message });
  }
});

/**
 * POST /api/asaas/withdraw
 * Solicita saque via PIX
 * Body: { amount, pixKey, pixKeyType }
 */
app.post("/api/asaas/withdraw", requireAuth, async (req, res) => {
  try {
    const { amount, pixKey, pixKeyType = "CPF" } = req.body;
    const uid = req.user.id;
    const PLATFORM_FEE_RATE = 0.0099;

    // Calcula saldo interno disponível (vendas pagas - taxas - saques já feitos)
    const [{ data: sales }, { data: withdrawals }] = await Promise.all([
      supabase.from("sales").select("amount, platform_fee").eq("owner_id", uid).eq("status", "pago"),
      supabase.from("withdrawals").select("amount, status").eq("owner_id", uid).in("status", ["processando", "concluido"]),
    ]);

    const totalSales    = (sales || []).reduce((a, s) => a + Number(s.amount), 0);
    const totalFees     = (sales || []).reduce((a, s) => a + Number(s.platform_fee ?? (Number(s.amount) * PLATFORM_FEE_RATE)), 0);
    const totalWithdrawn = (withdrawals || []).reduce((a, w) => a + Number(w.amount), 0);
    const available     = Math.max(0, totalSales - totalFees - totalWithdrawn);

    if (Number(amount) > available) {
      return res.status(400).json({
        error: `Saldo insuficiente. Disponível: ${available.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      });
    }

    const transfer = await asaas.post("/transfers", {
      value: amount,
      operationType: "PIX",
      pixAddressKey: pixKey,
      pixAddressKeyType: pixKeyType,
    });

    await supabase.from("withdrawals").insert({
      owner_id: uid,
      amount,
      status:   "processando",
      asaas_id: transfer.data.id,
      pix_key:  pixKey,
    });

    res.json({ status: "processando", transferId: transfer.data.id });
  } catch (err) {
    console.error("[asaas/withdraw]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.description || err.message });
  }
});

/**
 * POST /api/asaas/webhook
 * Recebe webhooks do Asaas (pagamento confirmado, estornado, etc.)
 * Configure a URL no painel Asaas: https://seu-dominio.com/api/asaas/webhook
 */
app.post("/api/asaas/webhook", async (req, res) => {
  const event = req.body;
  console.log("[asaas/webhook]", event.event, event.payment?.id);

  if (event.event === "PAYMENT_RECEIVED" || event.event === "PAYMENT_CONFIRMED") {
    const payment = event.payment;
    // Valor que o cliente pagou (inclui a taxa 0,99% embutida)
    const clientAmount    = Number(payment?.value || payment?.netValue || 0);
    // Taxa JosephPay = clientAmount - (clientAmount / 1.0099)  → exato
    const platformFee     = Math.round((clientAmount - clientAmount / 1.0099) * 100) / 100;
    // Valor que fica para o produtor = o preço base original
    const producerAmount  = Math.round((clientAmount / 1.0099) * 100) / 100;

    // ── CASO 1: Venda criada via /api/asaas/checkout (já existe em sales) ─────
    const { data: existingSale } = await supabase
      .from("sales")
      .select("id")
      .eq("asaas_id", payment.id)
      .maybeSingle();

    if (existingSale) {
      await supabase.from("sales")
        .update({ status: "pago", platform_fee: platformFee, producer_amount: producerAmount })
        .eq("asaas_id", payment.id);
      console.log(`[webhook] cobrança direta paga — taxa: R$${platformFee}, produtor: R$${producerAmount}`);

    } else if (payment.paymentLink) {
      // ── CASO 2: Pagamento via link de produto (/paymentLinks) ──────────────
      // Encontra qual produto gerou esse link
      const { data: product } = await supabase
        .from("products")
        .select("id, owner_id, price, name")
        .eq("asaas_link_id", payment.paymentLink)
        .maybeSingle();

      if (product) {
        await supabase.from("sales").insert({
          product_id:      product.id,
          owner_id:        product.owner_id,
          amount:          clientAmount,
          platform_fee:    platformFee,
          producer_amount: producerAmount,
          status:          "pago",
          asaas_id:        payment.id,
        });
        console.log(`[webhook] link-produto "${product.name}" pago — taxa: R$${platformFee}, produtor: R$${producerAmount}`);
      } else {
        console.warn("[webhook] paymentLink sem produto mapeado:", payment.paymentLink);
      }
    } else {
      console.warn("[webhook] pagamento sem sale nem paymentLink mapeado:", payment.id);
    }

  } else if (event.event === "PAYMENT_REFUNDED") {
    await supabase.from("sales")
      .update({ status: "estornado", platform_fee: 0, producer_amount: 0 })
      .eq("asaas_id", event.payment.id);

  } else if (event.event === "TRANSFER_DONE") {
    await supabase.from("withdrawals")
      .update({ status: "concluido" })
      .eq("asaas_id", event.transfer?.id);
  }

  res.json({ received: true });
});

/**
 * GET /api/asaas/balance
 * Retorna saldo disponível na conta Asaas
 */
app.get("/api/asaas/balance", requireAuth, async (req, res) => {
  try {
    const { data } = await asaas.get("/finance/balance");
    res.json({ balance: data.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — CHAT IA (Anthropic)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/chat
 * Proxy para Anthropic Messages API
 * Body: { messages: [{role, content}], productContext? }
 */
app.post("/api/chat", requireAuth, async (req, res) => {
  try {
    const { messages, productContext } = req.body;

    const systemPrompt = `Você é o assistente de IA da JosephPay, especializado em marketing digital, vendas online e infoprodutos.
Você ajuda produtores a crescerem suas vendas, gerenciar afiliados e otimizar suas estratégias.
${productContext ? `Contexto do produto: ${productContext}` : ""}
Responda sempre em português brasileiro, de forma direta e prática.`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   messages.map(m => ({ role: m.role, content: m.content })),
      },
      {
        headers: {
          "x-api-key":         process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type":      "application/json",
        },
      }
    );

    res.json({ reply: response.data.content[0].text });
  } catch (err) {
    console.error("[chat]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — WHATSAPP (Evolution API)
// ══════════════════════════════════════════════════════════════════════════════

const EVOLUTION_BASE   = process.env.EVOLUTION_API_URL;   // ex: https://evo.seudominio.com
const EVOLUTION_KEY    = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INST   = process.env.EVOLUTION_INSTANCE || "josephpay";

const evo = EVOLUTION_BASE ? axios.create({
  baseURL: EVOLUTION_BASE,
  headers: { apikey: EVOLUTION_KEY },
}) : null;

/**
 * GET /api/whatsapp/status
 * Verifica se a instância WhatsApp está conectada
 */
app.get("/api/whatsapp/status", requireAuth, async (req, res) => {
  if (!evo) return res.json({ connected: false, reason: "Evolution API não configurada" });
  try {
    const { data } = await evo.get(`/instance/connectionState/${EVOLUTION_INST}`);
    res.json({ connected: data.instance?.state === "open", state: data.instance?.state });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

/**
 * POST /api/whatsapp/send
 * Envia mensagem de texto via WhatsApp
 * Body: { to, message }  — "to" = número com DDI ex: "5511999990001"
 */
app.post("/api/whatsapp/send", requireAuth, async (req, res) => {
  if (!evo) return res.status(503).json({ error: "Evolution API não configurada" });
  try {
    const { to, message } = req.body;
    const { data } = await evo.post(`/message/sendText/${EVOLUTION_INST}`, {
      number: to,
      text: message,
    });

    // Salva no histórico de mensagens
    await supabase.from("messages").insert({
      owner_id:  req.user.id,
      channel:   "whatsapp",
      direction: "outbound",
      content:   message,
      status:    "sent",
    });

    res.json({ success: true, messageId: data.key?.id });
  } catch (err) {
    console.error("[whatsapp/send]", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp/webhook
 * Recebe mensagens inbound do Evolution API
 * Configure no painel Evolution: https://seu-dominio.com/api/whatsapp/webhook
 */
app.post("/api/whatsapp/webhook", async (req, res) => {
  const event = req.body;
  if (event.event === "messages.upsert" && event.data?.key?.fromMe === false) {
    const from    = event.data.key.remoteJid?.replace("@s.whatsapp.net", "");
    const content = event.data.message?.conversation || event.data.message?.extendedTextMessage?.text || "";
    if (content) {
      // Busca o owner pela instância (ajuste conforme sua lógica multi-tenant)
      // Por ora registra sem owner para processamento posterior
      console.log(`[WA inbound] de ${from}: ${content}`);
      await supabase.from("messages").insert({
        channel:   "whatsapp",
        direction: "inbound",
        content,
        status:    "delivered",
      });
    }
  }
  res.json({ received: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — DADOS DO DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/dashboard/kpis
 * KPIs do mês atual para o usuário autenticado
 */
app.get("/api/dashboard/kpis", requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
    const todayDate = now.toISOString().split("T")[0];

    const [salesMonth, salesToday, activeSubs] = await Promise.all([
      supabase.from("sales").select("amount").eq("owner_id", uid).eq("status", "pago").gte("created_at", monthStart),
      supabase.from("sales").select("id", { count: "exact", head: true }).eq("owner_id", uid).eq("status", "pago").gte("created_at", todayStart),
      supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("owner_id", uid).eq("status", "ativo"),
    ]);

    let receitaMes = (salesMonth.data || []).reduce((acc, s) => acc + Number(s.amount), 0);
    let vendasHoje = salesToday.count || 0;

    // Fallback: se DB está vazio, busca histórico de pagamentos do Asaas
    if (receitaMes === 0 && process.env.ASAAS_API_KEY) {
      try {
        const [asaasMes, asaasBalance] = await Promise.all([
          asaas.get(`/payments?status=RECEIVED&dateCreatedStart=${monthDate}&limit=100`),
          asaas.get("/finance/balance"),
        ]);
        const payments = asaasMes.data?.data || [];
        receitaMes = payments.reduce((a, p) => a + Number(p.value || 0), 0);
        vendasHoje = payments.filter(p => (p.dateCreated || "").startsWith(todayDate) || (p.confirmedDate || "").startsWith(todayDate)).length;
        // Inclui saldo disponível também
        res.json({
          receitaMes,
          vendasHoje,
          assinaturasAtivas: activeSubs.count || 0,
          saldoDisponivel: asaasBalance.data?.balance || 0,
          fonte: "asaas",
        });
        return;
      } catch (e) {
        console.warn("[kpis] Asaas fallback:", e.message);
      }
    }

    res.json({
      receitaMes,
      vendasHoje,
      assinaturasAtivas: activeSubs.count || 0,
    });
  } catch (err) {
    console.error("[dashboard/kpis]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — ADMIN (usam service role key → veem TODOS os dados)
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/admin/kpis — KPIs gerais da plataforma */
app.get("/api/admin/kpis", requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const [salesMonth, totalTx, profs, afils, subs] = await Promise.all([
      supabase.from("sales").select("amount").eq("status", "pago").gte("created_at", monthStart),
      supabase.from("sales").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("affiliates").select("id", { count: "exact", head: true }).eq("status", "ativo"),
      supabase.from("subscriptions").select("amount").eq("status", "ativo"),
    ]);
    const receitaMes = (salesMonth.data || []).reduce((a, s) => a + Number(s.amount), 0);
    const mrr = (subs.data || []).reduce((a, s) => a + Number(s.amount), 0);
    res.json({
      receitaMes,
      taxasMes: Math.round(receitaMes * 0.0099 * 100) / 100, // 0.99% taxa de conveniência

      transacoes: totalTx.count || 0,
      clientes: profs.count || 0,
      afiliados: afils.count || 0,
      mrr,
    });
  } catch (err) {
    console.error("[admin/kpis]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/admin/sales — Todas as vendas da plataforma (opcional: ?owner=uuid&limit=N) */
app.get("/api/admin/sales", requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const owner = req.query.owner;
    let q = supabase
      .from("sales")
      .select("*,customers(name),products(name),profiles!owner_id(name)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (owner) q = q.eq("owner_id", owner);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ sales: data || [] });
  } catch (err) {
    console.error("[admin/sales]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/admin/clients — Todos os produtores + resumo */
app.get("/api/admin/clients", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,name,role,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const enriched = await Promise.all((data || []).map(async (p) => {
      const [salesSum, prodCount] = await Promise.all([
        supabase.from("sales").select("amount,platform_fee").eq("owner_id", p.id).eq("status", "pago"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("owner_id", p.id),
      ]);
      const vol = (salesSum.data || []).reduce((a, s) => a + Number(s.amount), 0);
      const platformFeeVol = (salesSum.data || []).reduce((a, s) => a + (Number(s.platform_fee) || Math.round(Number(s.amount) * 0.0099 * 100) / 100), 0);
      return { ...p, vol, taxa: Math.round(platformFeeVol * 100) / 100, produtos: prodCount.count || 0 };
    }));
    res.json({ clients: enriched });
  } catch (err) {
    console.error("[admin/clients]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/admin/chart?period=mes — Vendas agregadas para gráfico (admin) */
app.get("/api/admin/chart", requireAuth, async (req, res) => {
  try {
    const period = req.query.period || "mes";
    const now = new Date();
    let from;
    if (period === "hoje") from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    else if (period === "semana") from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    else if (period === "mes") from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    else if (period === "trimestre") from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    else from = new Date(now.getFullYear(), 0, 1).toISOString();
    const { data } = await supabase.from("sales").select("amount,created_at").eq("status", "pago").gte("created_at", from);
    res.json({ sales: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — PRODUTOS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/products/create
 * Cria produto no Supabase + link de pagamento reutilizável no Asaas.
 *
 * Regra de taxa:
 *   - Produtor define preço base (ex: R$297)
 *   - JosephPay embute 0,99% no preço final do cliente (ex: R$299,94)
 *   - O link Asaas é criado com o preço final — o cliente paga o valor maior
 *   - Internamente, JosephPay separa a taxa e credita o valor base ao produtor
 *   - O produtor nunca vê a taxa — ele sempre vê o preço base
 */
app.post("/api/products/create", requireAuth, async (req, res) => {
  try {
    const { name, description, price, billingType = "UNDEFINED" } = req.body;
    if (!name || !price) return res.status(400).json({ error: "Nome e preço são obrigatórios" });

    const basePrice   = Math.round(Number(price) * 100) / 100;
    // Preço que o cliente final paga (taxa embutida — o produtor nunca vê isso)
    const clientPrice = Math.round(basePrice * 1.0099 * 100) / 100;

    let paymentUrl = "";
    let asaasLinkId = "";

    // Tenta criar Payment Link reutilizável (ideal para produtos digitais)
    try {
      const link = await asaas.post("/paymentLinks", {
        name,
        billingType:  billingType || "UNDEFINED",
        chargeType:   "DETACHED",   // nova cobrança por cliente — link reutilizável
        value:        clientPrice,
        description:  name + (description ? " — " + description : ""),
        isActive:     true,
      });
      paymentUrl  = link.data.url           || link.data.paymentLinkUrl || "";
      asaasLinkId = link.data.id            || "";
    } catch (linkErr) {
      console.warn("[products/create] paymentLinks indisponível, usando /payments:", linkErr.response?.data?.errors?.[0]?.description || linkErr.message);
      // Fallback: cobrança avulsa sem customer (link compartilhável)
      const dueDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const charge  = await asaas.post("/payments", {
        billingType: billingType || "UNDEFINED",
        value:       clientPrice,
        dueDate,
        description: name + (description ? " — " + description : ""),
      });
      paymentUrl  = charge.data.invoiceUrl || charge.data.bankSlipUrl || "";
      asaasLinkId = charge.data.id         || "";
    }

    // Salva produto no Supabase
    //   price       = preço base que o produtor vê e recebe
    //   asaas_price = preço que o cliente paga (com taxa embutida)
    //   asaas_link_id = ID do link/cobrança no Asaas (para rastrear webhook)
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .insert({
        name,
        description:   description || "",
        price:         basePrice,
        asaas_price:   clientPrice,
        asaas_link_id: asaasLinkId,
        status:        "ativo",
        owner_id:      req.user.id,
        url:           paymentUrl,
      })
      .select()
      .single();

    if (prodErr) console.warn("[products/create] Supabase insert warn:", prodErr.message);

    console.log(`[products/create] "${name}" — base: R$${basePrice}, cliente paga: R$${clientPrice}`);
    res.json({ product: product || { name, price: basePrice }, paymentUrl, asaasLinkId });
  } catch (err) {
    console.error("[products/create]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.description || err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — PRODUTOS (lista com stats)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/products
 * Lista produtos do produtor autenticado com receita do mês, total vendas,
 * assinaturas ativas e afiliados ativos.
 */
app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { data: products, error } = await supabase
      .from("products")
      .select("*")
      .eq("owner_id", uid)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const enriched = await Promise.all((products || []).map(async (p) => {
      const [salesMonth, totalSales, activeSubs, activeAffils] = await Promise.all([
        supabase.from("sales").select("amount").eq("product_id", p.id).eq("status", "pago").gte("created_at", monthStart),
        supabase.from("sales").select("id", { count: "exact", head: true }).eq("product_id", p.id).eq("status", "pago"),
        supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("product_id", p.id).eq("status", "ativo"),
        supabase.from("affiliates").select("id", { count: "exact", head: true }).eq("product_id", p.id).eq("status", "ativo"),
      ]);
      const receitaMes = (salesMonth.data || []).reduce((a, s) => a + Number(s.amount), 0);
      return {
        ...p,
        receitaMes,
        totalVendas:      totalSales.count  || 0,
        assinaturasAtivas: activeSubs.count  || 0,
        afiliadosAtivos:   activeAffils.count || 0,
      };
    }));

    res.json({ products: enriched });
  } catch (err) {
    console.error("[products]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — LEDGER (saldo interno por produtor)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ledger/balance
 * Saldo interno disponível para saque.
 * Fórmula: total vendas pagas - taxa plataforma (0.99%) - saques realizados
 */
app.get("/api/ledger/balance", requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const PLATFORM_FEE_RATE = 0.0099;

    const [{ data: sales }, { data: withdrawals }] = await Promise.all([
      supabase.from("sales").select("amount, platform_fee").eq("owner_id", uid).eq("status", "pago"),
      supabase.from("withdrawals").select("amount, status").eq("owner_id", uid).in("status", ["processando", "concluido"]),
    ]);

    const totalSales     = (sales || []).reduce((a, s) => a + Number(s.amount), 0);
    const totalFees      = (sales || []).reduce((a, s) => a + Number(s.platform_fee ?? (Number(s.amount) * PLATFORM_FEE_RATE)), 0);
    const totalWithdrawn = (withdrawals || []).reduce((a, w) => a + Number(w.amount), 0);
    const balance        = Math.max(0, totalSales - totalFees - totalWithdrawn);

    res.json({ balance, totalSales, totalFees, totalWithdrawn });
  } catch (err) {
    console.error("[ledger/balance]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — GRÁFICO DO PRODUTOR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/dashboard/chart?period=mes
 * Vendas do produtor autenticado por período para alimentar o gráfico.
 */
app.get("/api/dashboard/chart", requireAuth, async (req, res) => {
  try {
    const uid    = req.user.id;
    const period = req.query.period || "mes";
    const now    = new Date();
    let from;
    if (period === "hoje")      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    else if (period === "semana")   from = new Date(now.getTime() - 7  * 86400000).toISOString();
    else if (period === "mes")      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    else if (period === "trimestre") from = new Date(now.getTime() - 90 * 86400000).toISOString();
    else from = new Date(now.getFullYear(), 0, 1).toISOString();

    const { data } = await supabase
      .from("sales")
      .select("amount, created_at")
      .eq("owner_id", uid)
      .eq("status", "pago")
      .gte("created_at", from);

    res.json({ sales: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status:    "ok",
    timestamp: new Date().toISOString(),
    services:  {
      supabase:  !!process.env.SUPABASE_URL,
      asaas:     !!process.env.ASAAS_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      whatsapp:  !!process.env.EVOLUTION_API_URL,
    },
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 JosephPay API rodando na porta ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});
