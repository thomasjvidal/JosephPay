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
const ASAAS_URL = process.env.ASAAS_API_URL || "https://sandbox.asaas.com/api/v3";

const asaas = axios.create({
  baseURL: ASAAS_URL,
  headers: { access_token: process.env.ASAAS_API_KEY, "Content-Type": "application/json" },
});

// ── Taxa da plataforma ────────────────────────────────────────────────────────
// Opção B: 0.99% embutido no preço final do cliente → produtor recebe valor base
const PLATFORM_FEE_RATE = 0.0099;

// ── Helper: extrai as 3 taxas a partir de grossAmount + netAmount ─────────────
function calcFees(grossAmount, netAmount) {
  const gross = Number(grossAmount || 0);
  const net   = Number(netAmount   ?? gross);
  // platformFee = o que foi adicionado ao preço base (extrai 0.99% embutido)
  const platformFee    = Math.round((gross - gross / (1 + PLATFORM_FEE_RATE)) * 100) / 100;
  const asaasFee       = Math.round((gross - net) * 100) / 100;
  const producerAmount = Math.round((net - platformFee) * 100) / 100;
  return { platformFee, asaasFee, producerAmount };
}

async function updateCustomerStats(customerId) {
  if (!customerId) return;
  try {
    const { data: stats } = await supabase
      .from("sales").select("producer_amount,created_at")
      .eq("customer_id", customerId)
      .in("status", ["pago","confirmado","recebido"]);
    if (!stats?.length) return;
    const totalSpent = stats.reduce((s, r) => s + Number(r.producer_amount || 0), 0);
    const sorted = [...stats].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    await supabase.from("customers").update({
      total_spent:   Math.round(totalSpent * 100) / 100,
      total_orders:  stats.length,
      last_purchase: sorted[0]?.created_at,
    }).eq("id", customerId);
  } catch(e) {
    console.warn("[updateCustomerStats]", e.message);
  }
}

// ── Middleware: verifica JWT do Supabase em rotas protegidas ─────────────────
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Token ausente" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Token inválido" });
  req.user = user;

  // Garante que o profile existe no banco (fire-and-forget)
  const profileData = {
    id:    user.id,
    name:  user.user_metadata?.name || user.email?.split("@")[0] || "Produtor",
    role:  user.user_metadata?.role || "client",
    email: user.email,
  };
  supabase.from("profiles")
    .upsert(profileData, { onConflict: "id" })
    .then(({ error: e }) => {
      if (e) {
        const { email: _e, ...sem } = profileData;
        supabase.from("profiles").upsert(sem, { onConflict: "id" }).then(() => {});
      }
    });

  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — PRODUTOS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/products/create
 * Cria link de pagamento no Asaas + salva produto no Supabase.
 * BLOQUEIA se Asaas falhar — produto nunca salva sem link real.
 *
 * Opção B (taxa): produtor define preço base → cliente paga base * 1.0099
 *   → webhook extrai a diferença como platform_fee
 *   → produtor recebe o valor base exato
 */
app.post("/api/products/create", requireAuth, async (req, res) => {
  try {
    const { name, description, price, billingType = "UNDEFINED" } = req.body;
    if (!name || !price) return res.status(400).json({ error: "Nome e preço são obrigatórios" });

    const basePrice   = Math.round(Number(price) * 100) / 100;
    const clientPrice = Math.round(basePrice * (1 + PLATFORM_FEE_RATE) * 100) / 100;
    const asaasBase   = ASAAS_URL.replace("/api/v3", "");
    const isRecurrent = billingType === "RECURRENT";

    const payload = {
      name,
      billingType:     "UNDEFINED", // aceita todos os métodos de pagamento
      chargeType:      isRecurrent ? "RECURRENT" : "DETACHED",
      value:           clientPrice,
      description:     name + (description ? " — " + description : ""),
      isActive:        true,
      dueDateLimitDays: 3,          // campo obrigatório: dias úteis para vencimento
      externalReference: `owner_${req.user.id}`,
      customerPaysFees: true,       // repassa taxas Asaas ao cliente final
    };
    if (isRecurrent) {
      payload.subscriptionCycle = "MONTHLY";
    } else {
      payload.allowInstallment   = true;  // habilita parcelamento
      payload.maxInstallmentCount = 12;   // até 12x
    }

    console.log("[products/create] payload Asaas:", JSON.stringify(payload));

    let paymentUrl  = "";
    let asaasLinkId = "";

    try {
      const resp = await asaas.post("/paymentLinks", payload);
      console.log("[products/create] resposta Asaas:", JSON.stringify({
        id: resp.data.id, url: resp.data.url,
        paymentLinkUrl: resp.data.paymentLinkUrl, shortUrl: resp.data.shortUrl,
        customerPaysFees: resp.data.customerPaysFees,
      }));
      asaasLinkId = resp.data.id || "";
      paymentUrl  = resp.data.url
        || resp.data.paymentLinkUrl
        || resp.data.shortUrl
        || (asaasLinkId ? `${asaasBase}/c/${asaasLinkId}` : "");

      // Habilitar repasse de taxas ao cliente via PUT (configurado na 2ª etapa no Asaas)
      if (asaasLinkId) {
        try {
          const putResp = await asaas.put(`/paymentLinks/${asaasLinkId}`, {
            ...payload,
            customerPaysFees: true,
          });
          const taxRepass = putResp.data?.customerPaysFees;
          console.log("[products/create] customerPaysFees via PUT:", taxRepass ? "✓ ativo" : "✗ não ativado");
        } catch(e) {
          console.warn("[products/create] falha ao habilitar repasse de taxas:", e.message);
        }
      }
    } catch (asaasErr) {
      const errMsg = asaasErr.response?.data?.errors?.[0]?.description || asaasErr.message;
      console.error("[products/create] ERRO Asaas:", JSON.stringify(asaasErr.response?.data));
      return res.status(400).json({
        error: `Não foi possível criar o link no Asaas: ${errMsg}`,
      });
    }

    if (!asaasLinkId) {
      return res.status(400).json({
        error: "Asaas retornou resposta sem ID de link. Verifique os logs do Railway.",
      });
    }

    // Salva no Supabase — schema completo (migration_v2 já aplicada)
    const { data: product, error: dbErr } = await supabase.from("products").insert({
      name,
      description:   description || "",
      price:         basePrice,
      asaas_price:   clientPrice,
      asaas_link_id: asaasLinkId,
      status:        "ativo",
      owner_id:      req.user.id,
      url:           paymentUrl,
    }).select().single();

    if (dbErr) {
      console.error("[products/create] erro Supabase:", dbErr.message);
      return res.status(500).json({
        error: `Link criado no Asaas (${asaasLinkId}) mas não salvo no banco: ${dbErr.message}`,
        paymentUrl, asaasLinkId,
      });
    }

    console.log(`[products/create] "${name}" salvo id=${product.id} — base R$${basePrice}, cliente R$${clientPrice}`);
    res.json({ product, paymentUrl, asaasLinkId });
  } catch (err) {
    console.error("[products/create] erro geral:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/products
 * Lista produtos do produtor autenticado com stats do mês.
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
        supabase.from("sales").select("producer_amount,amount").eq("product_id", p.id).eq("status", "pago").gte("created_at", monthStart),
        supabase.from("sales").select("id", { count: "exact", head: true }).eq("product_id", p.id).eq("status", "pago"),
        supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("product_id", p.id).eq("status", "ativo"),
        supabase.from("affiliates").select("id", { count: "exact", head: true }).eq("product_id", p.id).eq("status", "ativo"),
      ]);
      const receitaMes = (salesMonth.data || []).reduce((a, s) => a + Number(s.producer_amount || s.amount || 0), 0);
      return {
        ...p,
        receitaMes,
        totalVendas:       totalSales.count  || 0,
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

/**
 * DELETE /api/products/:id
 * Remove produto. Apenas o dono pode deletar.
 */
app.delete("/api/products/:id", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", req.params.id)
      .eq("owner_id", req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("[products/delete]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/products/:id/sync
 * Sincroniza produto com dados reais do Asaas (customerPaysFees, URL, status).
 */
app.get("/api/products/:id/sync", requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { data: product } = await supabase.from("products")
      .select("id,asaas_link_id").eq("id", req.params.id).eq("owner_id", uid).maybeSingle();
    if (!product?.asaas_link_id) return res.status(404).json({ error: "Produto não encontrado" });

    const { data: link } = await asaas.get(`/paymentLinks/${product.asaas_link_id}`);

    if (link?.url) {
      await supabase.from("products").update({ url: link.url }).eq("id", product.id);
    }

    res.json({
      asaas_link_id:    product.asaas_link_id,
      customerPaysFees: link?.customerPaysFees ?? false,
      active:           link?.active ?? true,
      url:              link?.url,
      value:            link?.value,
    });
  } catch (err) {
    console.error("[products/sync]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — ASAAS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/asaas/checkout
 * Cria cobrança avulsa (requer cliente cadastrado no Asaas).
 */
app.post("/api/asaas/checkout", requireAuth, async (req, res) => {
  try {
    const { productId, amount, description, billingType = "UNDEFINED", customer } = req.body;

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

    const charge = await asaas.post("/payments", {
      customer:          asaasCustomerId,
      billingType,
      value:             amount,
      dueDate:           new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      description:       description || "JosephPay",
      externalReference: `owner_${req.user.id}`,
    });

    await supabase.from("sales").insert({
      product_id:  productId,
      owner_id:    req.user.id,
      amount,
      gross_amount: amount,
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
 * Solicita saque via PIX.
 */
app.post("/api/asaas/withdraw", requireAuth, async (req, res) => {
  try {
    const { amount, pixKey, pixKeyType = "CPF" } = req.body;
    const uid = req.user.id;

    const [{ data: sales }, { data: withdrawals }] = await Promise.all([
      supabase.from("sales").select("producer_amount,amount,platform_fee").eq("owner_id", uid).eq("status", "pago"),
      supabase.from("withdrawals").select("amount,status").eq("owner_id", uid).in("status", ["processando", "concluido"]),
    ]);

    const totalProducer  = (sales || []).reduce((a, s) => a + Number(s.producer_amount ?? (Number(s.amount) * (1 - PLATFORM_FEE_RATE))), 0);
    const totalWithdrawn = (withdrawals || []).reduce((a, w) => a + Number(w.amount), 0);
    const available      = Math.max(0, totalProducer - totalWithdrawn);

    if (Number(amount) > available) {
      return res.status(400).json({
        error: `Saldo insuficiente. Disponível: ${available.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      });
    }

    const transfer = await asaas.post("/transfers", {
      value:             amount,
      operationType:     "PIX",
      pixAddressKey:     pixKey,
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
 * Recebe eventos do Asaas.
 * Configure no painel Asaas → Configurações → Webhooks:
 *   URL: https://josephpay-production.up.railway.app/api/asaas/webhook
 */
app.post("/api/asaas/webhook", async (req, res) => {
  const event = req.body;
  console.log("[asaas/webhook]", event.event, event.payment?.id);

  if (event.event === "PAYMENT_RECEIVED" || event.event === "PAYMENT_CONFIRMED") {
    const payment = event.payment;

    // ── Proteção contra duplicata ─────────────────────────────────────────────
    // Asaas dispara PAYMENT_RECEIVED e PAYMENT_CONFIRMED para o mesmo pagamento
    const { data: alreadyExists } = await supabase
      .from("sales")
      .select("id")
      .eq("asaas_id", payment.id)
      .maybeSingle();

    if (alreadyExists) {
      // Só atualiza status e dados financeiros, não cria nova linha
      const gross = Number(payment.value || 0);
      const net   = Number(payment.netValue || gross);
      const { platformFee, asaasFee, producerAmount } = calcFees(gross, net);
      await supabase.from("sales").update({
        status:            event.event === "PAYMENT_RECEIVED" ? "recebido" : "confirmado",
        gross_amount:      gross,
        net_amount:        net,
        asaas_fee:         asaasFee,
        platform_fee:      platformFee,
        producer_amount:   producerAmount,
        installment_count: payment.installmentCount || 1,
        billing_type:      payment.billingType || "UNKNOWN",
        payment_date:      payment.confirmedDate || payment.paymentDate || new Date().toISOString(),
      }).eq("asaas_id", payment.id);
      console.log(`[webhook] duplicata ignorada — atualizando ${payment.id}`);
      return res.json({ received: true });
    }

    // ── Dados financeiros reais ───────────────────────────────────────────────
    const grossAmount = Number(payment.value || 0);
    const netAmount   = Number(payment.netValue || grossAmount);
    const { platformFee, asaasFee, producerAmount } = calcFees(grossAmount, netAmount);
    const paymentDate = payment.confirmedDate || payment.paymentDate || new Date().toISOString();

    // ── Cria/atualiza customer usando asaas_customer_id (sem duplicar por PIX) ─
    let customerId = null;
    const asaasCustomerId = payment.customer;
    if (asaasCustomerId) {
      let custObj = payment.customerObject || {};
      if (!custObj.name) {
        try {
          const { data: asaasCust } = await asaas.get(`/customers/${asaasCustomerId}`);
          if (asaasCust?.name) custObj = asaasCust;
        } catch(e) {
          console.warn("[webhook] falha ao buscar cliente Asaas:", e.message);
        }
      }
      const custName  = custObj.name  || "Cliente";
      const custEmail = custObj.email || null;
      const custPhone = custObj.mobilePhone || custObj.phone || null;

      // Descobre owner via produto ou externalReference
      let ownerForCustomer = null;
      if (payment.paymentLink) {
        const { data: prod } = await supabase.from("products")
          .select("owner_id").eq("asaas_link_id", payment.paymentLink).maybeSingle();
        ownerForCustomer = prod?.owner_id;
      }
      if (!ownerForCustomer && payment.externalReference?.startsWith("owner_")) {
        ownerForCustomer = payment.externalReference.replace("owner_", "");
      }

      if (ownerForCustomer) {
        const { data: cust } = await supabase.from("customers").upsert(
          { name: custName, email: custEmail, phone: custPhone, owner_id: ownerForCustomer, asaas_customer_id: asaasCustomerId },
          { onConflict: "asaas_customer_id", ignoreDuplicates: false }
        ).select("id").maybeSingle();
        customerId = cust?.id || null;
      }
    }

    // ── Payload base ──────────────────────────────────────────────────────────
    const saleBase = {
      amount:            grossAmount,
      gross_amount:      grossAmount,
      net_amount:        netAmount,
      asaas_fee:         asaasFee,
      platform_fee:      platformFee,
      producer_amount:   producerAmount,
      installment_count: payment.installmentCount || 1,
      billing_type:      payment.billingType || "UNKNOWN",
      payment_date:      paymentDate,
      status:            event.event === "PAYMENT_RECEIVED" ? "recebido" : "confirmado",
      asaas_id:          payment.id,
      customer_id:       customerId,
    };

    if (payment.paymentLink) {
      // ── CASO 2: Pagamento via link de produto ─────────────────────────────
      const { data: product } = await supabase.from("products")
        .select("id,owner_id,name,price")
        .eq("asaas_link_id", payment.paymentLink)
        .maybeSingle();

      if (product) {
        // Opção B: produtor recebe exatamente o preço base que ele definiu
        saleBase.producer_amount = Number(product.price);
        saleBase.platform_fee    = Math.round((grossAmount - Number(product.price)) * 100) / 100;

        await supabase.from("sales").insert({ ...saleBase, product_id: product.id, owner_id: product.owner_id });
        console.log(`[webhook] produto "${product.name}" pago — bruto R$${grossAmount}, produtor R$${product.price}`);
        await updateCustomerStats(customerId);

        if (payment.subscription) {
          const { data: existingSub } = await supabase.from("subscriptions")
            .select("id").eq("asaas_id", payment.subscription).maybeSingle();
          if (existingSub) {
            await supabase.from("subscriptions")
              .update({ status: "ativo", customer_id: customerId, amount: Number(product.price) })
              .eq("asaas_id", payment.subscription);
          } else {
            await supabase.from("subscriptions").insert({
              asaas_id:    payment.subscription,
              product_id:  product.id,
              owner_id:    product.owner_id,
              customer_id: customerId,
              amount:      Number(product.price),
              status:      "ativo",
              plan:        "mensal",
            });
          }
          console.log(`[webhook] assinatura ${payment.subscription} salva`);
        }

      } else if (payment.externalReference?.startsWith("owner_")) {
        // ── CASO 3: Fallback via externalReference ────────────────────────
        const ownerId = payment.externalReference.replace("owner_", "");
        // Sem product.price: extrai valor base pelo inverso da taxa embutida
        saleBase.producer_amount = Math.round(grossAmount / (1 + PLATFORM_FEE_RATE) * 100) / 100;
        saleBase.platform_fee    = Math.round((grossAmount - saleBase.producer_amount) * 100) / 100;
        await supabase.from("sales").insert({ ...saleBase, owner_id: ownerId });
        console.log(`[webhook] venda via externalReference owner=${ownerId} — bruto R$${grossAmount}, produtor R$${saleBase.producer_amount}`);
        await updateCustomerStats(customerId);

      } else {
        console.warn("[webhook] paymentLink sem produto nem externalReference:", payment.paymentLink);
      }

    } else {
      console.warn("[webhook] pagamento sem paymentLink e sem registro existente:", payment.id);
    }

  } else if (event.event === "PAYMENT_REFUNDED") {
    await supabase.from("sales")
      .update({ status: "estornado", platform_fee: 0, producer_amount: 0, asaas_fee: 0 })
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

app.post("/api/chat", requireAuth, async (req, res) => {
  try {
    const { messages, productContext } = req.body;
    const systemPrompt = `Você é o assistente de IA da JosephPay, especializado em marketing digital, vendas online e infoprodutos.
Você ajuda produtores a crescerem suas vendas, gerenciar afiliados e otimizar suas estratégias.
${productContext ? `Contexto do produto: ${productContext}` : ""}
Responda sempre em português brasileiro, de forma direta e prática.`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      { model: "claude-haiku-4-5-20251001", max_tokens: 1024, system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })) },
      { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" } }
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

const EVOLUTION_BASE = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY  = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INST = process.env.EVOLUTION_INSTANCE || "josephpay";

// Só cria cliente se URL não for o placeholder padrão
const evo = EVOLUTION_BASE && !EVOLUTION_BASE.includes("seudominio") ? axios.create({
  baseURL: EVOLUTION_BASE,
  headers: { apikey: EVOLUTION_KEY },
}) : null;

app.get("/api/whatsapp/status", requireAuth, async (req, res) => {
  if (!evo) return res.json({ connected: false, reason: "Evolution API não configurada" });
  try {
    const { data } = await evo.get(`/instance/connectionState/${EVOLUTION_INST}`);
    res.json({ connected: data.instance?.state === "open", state: data.instance?.state });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.post("/api/whatsapp/send", requireAuth, async (req, res) => {
  if (!evo) return res.status(503).json({ error: "Evolution API não configurada" });
  try {
    const { to, message } = req.body;
    const { data } = await evo.post(`/message/sendText/${EVOLUTION_INST}`, { number: to, text: message });
    await supabase.from("messages").insert({
      owner_id: req.user.id, channel: "whatsapp", direction: "outbound", content: message, status: "sent",
    });
    res.json({ success: true, messageId: data.key?.id });
  } catch (err) {
    console.error("[whatsapp/send]", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/whatsapp/webhook", async (req, res) => {
  const event = req.body;
  if (event.event === "messages.upsert" && event.data?.key?.fromMe === false) {
    const from    = event.data.key.remoteJid?.replace("@s.whatsapp.net", "");
    const content = event.data.message?.conversation || event.data.message?.extendedTextMessage?.text || "";
    if (content) {
      console.log(`[WA inbound] de ${from}: ${content}`);
      await supabase.from("messages").insert({ channel: "whatsapp", direction: "inbound", content, status: "delivered" });
    }
  }
  res.json({ received: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — DASHBOARD DO PRODUTOR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/dashboard/kpis
 * Retorna bruto, líquido e taxas separadas.
 * Usa payment_date para período (fallback created_at para registros sem o campo).
 */
app.get("/api/dashboard/kpis", requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const [salesMonth, salesToday, activeSubs, totalCustomers] = await Promise.all([
      supabase.from("sales")
        .select("amount,gross_amount,net_amount,asaas_fee,platform_fee,producer_amount")
        .eq("owner_id", uid).eq("status", "pago")
        .or(`payment_date.gte.${monthStart},and(payment_date.is.null,created_at.gte.${monthStart})`),
      supabase.from("sales")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", uid).eq("status", "pago")
        .or(`payment_date.gte.${todayStart},and(payment_date.is.null,created_at.gte.${todayStart})`),
      supabase.from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", uid).eq("status", "ativo"),
      supabase.from("customers")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", uid),
    ]);

    const sales = salesMonth.data || [];
    const receitaBrutaMes   = sales.reduce((a, s) => a + Number(s.gross_amount || s.amount || 0), 0);
    const receitaLiquidaMes = sales.reduce((a, s) => a + Number(s.producer_amount || 0), 0);
    const taxasAsaasMes     = sales.reduce((a, s) => a + Number(s.asaas_fee || 0), 0);
    const taxaPlataformaMes = sales.reduce((a, s) => a + Number(s.platform_fee || 0), 0);

    res.json({
      receitaBrutaMes:   Math.round(receitaBrutaMes   * 100) / 100,
      receitaLiquidaMes: Math.round(receitaLiquidaMes * 100) / 100,
      taxasAsaasMes:     Math.round(taxasAsaasMes     * 100) / 100,
      taxaPlataformaMes: Math.round(taxaPlataformaMes * 100) / 100,
      receitaMes:        Math.round(receitaLiquidaMes * 100) / 100, // alias compatível
      vendasHoje:        salesToday.count || 0,
      assinaturasAtivas: activeSubs.count || 0,
      totalClientes:     totalCustomers.count || 0,
    });
  } catch (err) {
    console.error("[dashboard/kpis]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/chart?period=mes
 */
app.get("/api/dashboard/chart", requireAuth, async (req, res) => {
  try {
    const uid    = req.user.id;
    const period = req.query.period || "mes";
    const now    = new Date();
    let from;
    if      (period === "hoje")      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    else if (period === "semana")    from = new Date(now.getTime() - 7  * 86400000).toISOString();
    else if (period === "mes")       from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    else if (period === "trimestre") from = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1).toISOString();
    else                             from = new Date(now.getFullYear(), 0, 1).toISOString();

    const { data } = await supabase.from("sales")
      .select("producer_amount,amount,payment_date,created_at")
      .eq("owner_id", uid).eq("status", "pago")
      .or(`payment_date.gte.${from},and(payment_date.is.null,created_at.gte.${from})`);

    const normalized = (data || []).map(s => ({
      amount:     Number(s.producer_amount || s.amount || 0),
      created_at: s.created_at, // usar processing time (payment_date pode ser só data sem hora)
    }));

    res.json({ sales: normalized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — ADMIN (service role — vê TODOS os dados)
// ══════════════════════════════════════════════════════════════════════════════

app.get("/api/admin/kpis", requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const [salesMonth, totalTx, profs, afils, subs] = await Promise.all([
      supabase.from("sales").select("gross_amount,amount,platform_fee,asaas_fee").eq("status", "pago")
        .or(`payment_date.gte.${monthStart},and(payment_date.is.null,created_at.gte.${monthStart})`),
      supabase.from("sales").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("affiliates").select("id", { count: "exact", head: true }).eq("status", "ativo"),
      supabase.from("subscriptions").select("amount").eq("status", "ativo"),
    ]);
    const receitaMes = (salesMonth.data || []).reduce((a, s) => a + Number(s.gross_amount || s.amount || 0), 0);
    const taxasMes   = (salesMonth.data || []).reduce((a, s) => a + Number(s.platform_fee || Math.round(Number(s.gross_amount || s.amount || 0) * PLATFORM_FEE_RATE * 100) / 100), 0);
    const mrr = (subs.data || []).reduce((a, s) => a + Number(s.amount), 0);
    res.json({
      receitaMes: Math.round(receitaMes * 100) / 100,
      taxasMes:   Math.round(taxasMes   * 100) / 100,
      transacoes: totalTx.count || 0,
      clientes:   profs.count   || 0,
      afiliados:  afils.count   || 0,
      mrr:        Math.round(mrr * 100) / 100,
    });
  } catch (err) {
    console.error("[admin/kpis]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/sales", requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const owner = req.query.owner;
    let q = supabase.from("sales")
      .select("*,customers(name),products(name),profiles!owner_id(name)")
      .order("created_at", { ascending: false }).limit(limit);
    if (owner) q = q.eq("owner_id", owner);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ sales: data || [] });
  } catch (err) {
    console.error("[admin/sales]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/clients", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("profiles")
      .select("id,name,role,created_at").order("created_at", { ascending: false });
    if (error) throw error;
    const enriched = await Promise.all((data || []).map(async (p) => {
      const [salesSum, prodCount] = await Promise.all([
        supabase.from("sales").select("gross_amount,amount,platform_fee").eq("owner_id", p.id).eq("status", "pago"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("owner_id", p.id),
      ]);
      const vol  = (salesSum.data || []).reduce((a, s) => a + Number(s.gross_amount || s.amount || 0), 0);
      const taxa = (salesSum.data || []).reduce((a, s) => a + Number(s.platform_fee || Math.round(Number(s.gross_amount || s.amount || 0) * PLATFORM_FEE_RATE * 100) / 100), 0);
      return { ...p, vol: Math.round(vol * 100) / 100, taxa: Math.round(taxa * 100) / 100, produtos: prodCount.count || 0 };
    }));
    res.json({ clients: enriched });
  } catch (err) {
    console.error("[admin/clients]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/chart", requireAuth, async (req, res) => {
  try {
    const period = req.query.period || "mes";
    const owner  = req.query.owner;
    const now    = new Date();
    let from;
    if      (period === "hoje")      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    else if (period === "semana")    from = new Date(now.getTime() - 7  * 86400000).toISOString();
    else if (period === "mes")       from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    else if (period === "trimestre") from = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1).toISOString();
    else                             from = new Date(now.getFullYear(), 0, 1).toISOString();

    let q = supabase.from("sales").select("gross_amount,amount,payment_date,created_at").eq("status", "pago")
      .or(`payment_date.gte.${from},and(payment_date.is.null,created_at.gte.${from})`);
    if (owner) q = q.eq("owner_id", owner);
    const { data } = await q;

    const normalized = (data || []).map(s => ({
      amount:     Number(s.gross_amount || s.amount || 0),
      created_at: s.payment_date || s.created_at,
    }));

    res.json({ sales: normalized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — LEDGER (saldo interno)
// ══════════════════════════════════════════════════════════════════════════════

app.get("/api/ledger/balance", requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [{ data: sales }, { data: withdrawals }] = await Promise.all([
      supabase.from("sales").select("producer_amount,amount,platform_fee").eq("owner_id", uid).in("status", ["recebido","pago"]),
      supabase.from("withdrawals").select("amount,status").eq("owner_id", uid).in("status", ["processando", "concluido"]),
    ]);
    const totalProducer  = (sales || []).reduce((a, s) => a + Number(s.producer_amount ?? (Number(s.amount) * (1 - PLATFORM_FEE_RATE))), 0);
    const totalWithdrawn = (withdrawals || []).reduce((a, w) => a + Number(w.amount), 0);
    const balance        = Math.max(0, totalProducer - totalWithdrawn);
    res.json({
      balance:         Math.round(balance * 100) / 100,
      totalProducer:   Math.round(totalProducer * 100) / 100,
      totalWithdrawn:  Math.round(totalWithdrawn * 100) / 100,
    });
  } catch (err) {
    console.error("[ledger/balance]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC — importa pagamentos históricos do Asaas
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/sync/history
 * Puxa os últimos 90 dias do Asaas e salva em sales com todos os campos financeiros.
 */
app.post("/api/sync/history", requireAuth, async (req, res) => {
  try {
    const uid   = req.user.id;
    const since = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];

    let asaasPayments = [];
    try {
      const [r1, r2] = await Promise.all([
        asaas.get(`/payments?status=RECEIVED&dateCreatedStart=${since}&limit=100`),
        asaas.get(`/payments?status=CONFIRMED&dateCreatedStart=${since}&limit=100`),
      ]);
      asaasPayments = [...(r1.data?.data || []), ...(r2.data?.data || [])];
      const seen = new Set();
      asaasPayments = asaasPayments.filter(p => seen.has(p.id) ? false : seen.add(p.id));
    } catch (e) {
      console.warn("[sync/history] Asaas fetch error:", e.message);
    }

    const { data: products } = await supabase.from("products")
      .select("id,owner_id,price,name,asaas_link_id").eq("owner_id", uid);

    const { data: existingSales } = await supabase.from("sales").select("asaas_id").eq("owner_id", uid);
    const existingIds = new Set((existingSales || []).map(s => s.asaas_id));

    let inserted = 0, skipped = 0, errors = 0;

    for (const payment of asaasPayments) {
      if (existingIds.has(payment.id)) { skipped++; continue; }

      const grossAmount = Number(payment.value || 0);
      const netAmount   = Number(payment.netValue || grossAmount);
      const { platformFee, asaasFee, producerAmount } = calcFees(grossAmount, netAmount);
      const paymentDate = (payment.confirmedDate || payment.dateCreated)
        ? new Date(payment.confirmedDate || payment.dateCreated).toISOString()
        : new Date().toISOString();

      const product = (products || []).find(p =>
        p.asaas_link_id && payment.paymentLink && p.asaas_link_id === payment.paymentLink
      );

      // Cria/atualiza customer
      let customerId = null;
      if (payment.customer) {
        const custObj   = payment.customerObject || {};
        const custName  = custObj.name || "Cliente";
        const custEmail = custObj.email || null;
        const custPhone = custObj.phone || null;
        const { data: cust } = await supabase.from("customers").upsert(
          { name: custName, email: custEmail, phone: custPhone, owner_id: product?.owner_id || uid, asaas_customer_id: payment.customer },
          { onConflict: "asaas_customer_id", ignoreDuplicates: false }
        ).select("id").maybeSingle();
        customerId = cust?.id || null;
      }

      const salePayload = {
        product_id:        product?.id      || null,
        owner_id:          product?.owner_id || uid,
        customer_id:       customerId,
        amount:            grossAmount,
        gross_amount:      grossAmount,
        net_amount:        netAmount,
        asaas_fee:         asaasFee,
        platform_fee:      platformFee,
        producer_amount:   producerAmount,
        installment_count: payment.installmentCount || 1,
        billing_type:      payment.billingType || "UNKNOWN",
        payment_date:      paymentDate,
        status:            "pago",
        asaas_id:          payment.id,
        created_at:        paymentDate,
      };

      const { error: insErr } = await supabase.from("sales").insert(salePayload);
      if (insErr) {
        console.warn("[sync/history] insert error:", insErr.message, "payment:", payment.id);
        errors++;
      } else {
        inserted++;
        existingIds.add(payment.id);
      }
    }

    console.log(`[sync/history] user=${uid} — inserted:${inserted} skipped:${skipped} errors:${errors}`);
    res.json({ inserted, skipped, errors, total: asaasPayments.length });
  } catch (err) {
    console.error("[sync/history]", err.message);
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
      whatsapp:  !!(process.env.EVOLUTION_API_URL && !process.env.EVOLUTION_API_URL.includes("seudominio")),
    },
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 JosephPay API rodando na porta ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});
