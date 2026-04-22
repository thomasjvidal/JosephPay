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

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const ok =
      origin === process.env.FRONTEND_ORIGIN ||
      origin.endsWith(".vercel.app") ||
      origin.startsWith("http://localhost");
    cb(null, ok);
  },
  credentials: true,
}));
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
  if (!cachedOwnerId) cachedOwnerId = user.id;

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
    const { name, description, price, billingType = "UNDEFINED", subscriptionCycle = "MONTHLY" } = req.body;
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
      payload.subscriptionCycle = subscriptionCycle;
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
      description:      description || "",
      price:            basePrice,
      asaas_price:      clientPrice,
      asaas_link_id:    asaasLinkId,
      status:           "ativo",
      owner_id:         req.user.id,
      url:              paymentUrl,
      billing_type:     billingType || "UNDEFINED",
      subscription_cycle: isRecurrent ? subscriptionCycle : null,
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

    // Fallback: busca sale pelo saleId embutido no externalReference (installments, assinaturas)
    let existsByRef = null;
    if (!alreadyExists && payment.externalReference) {
      try {
        const ref = JSON.parse(payment.externalReference);
        if (ref?.saleId) {
          const { data } = await supabase.from("sales").select("id").eq("id", ref.saleId).maybeSingle();
          existsByRef = data;
        }
      } catch { /* formato legado — ignora */ }
    }

    const existingSale = alreadyExists || existsByRef;
    if (existingSale) {
      // Atualiza só campos operacionais — valores financeiros já foram calculados corretamente no checkout
      await supabase.from("sales").update({
        status:            "pago",
        asaas_id:          payment.id,
        installment_count: payment.installmentCount || 1,
        billing_type:      payment.billingType || "UNKNOWN",
        payment_date:      payment.confirmedDate || payment.paymentDate || new Date().toISOString(),
      }).eq("id", existingSale.id);
      console.log(`[webhook] sale atualizada via ${alreadyExists ? "asaas_id" : "externalRef"} — ${payment.id}`);
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
        // check-then-insert: índice parcial (WHERE asaas_customer_id IS NOT NULL)
        // não funciona com onConflict no PostgREST — fazemos lookup manual
        const { data: existingCust } = await supabase.from("customers")
          .select("id")
          .eq("asaas_customer_id", asaasCustomerId)
          .eq("owner_id", ownerForCustomer)
          .maybeSingle();

        if (existingCust) {
          await supabase.from("customers")
            .update({ name: custName, email: custEmail, phone: custPhone })
            .eq("id", existingCust.id);
          customerId = existingCust.id;
          console.log("[webhook] customer atualizado:", customerId, custName);
        } else {
          const { data: newCust, error: custErr } = await supabase.from("customers")
            .insert({ name: custName, email: custEmail, phone: custPhone,
                      owner_id: ownerForCustomer, asaas_customer_id: asaasCustomerId })
            .select("id").maybeSingle();
          if (custErr) {
            console.error("[webhook] ERRO ao criar customer:", custErr.message, custErr.code, custErr.details);
          } else {
            customerId = newCust?.id || null;
            console.log("[webhook] customer criado:", customerId, custName);
          }
        }
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
      status:            "pago",
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
          await supabase.from("customers").update({ status: "assinante" }).eq("id", customerId)
            .then(null, e => console.warn("[webhook] status assinante:", e.message));
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
const PUBLIC_URL     = process.env.PUBLIC_URL || "https://josephpay-production.up.railway.app";

// Só cria cliente se URL não for o placeholder padrão
const evo = EVOLUTION_BASE && !EVOLUTION_BASE.includes("seudominio") ? axios.create({
  baseURL: EVOLUTION_BASE,
  headers: { apikey: EVOLUTION_KEY },
  timeout: 5000,
}) : null;

// ── Owner ID cache (preenchido na 1ª requisição autenticada) ─────────────────
let cachedOwnerId = null;

app.get("/api/whatsapp/status", requireAuth, async (req, res) => {
  if (!evo) return res.json({ connected: false, reason: "Evolution API não configurada" });
  try {
    const { data } = await evo.get(`/instance/connectionState/${EVOLUTION_INST}`);
    res.json({ connected: data.instance?.state === "open", state: data.instance?.state });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.get("/api/whatsapp/qr", requireAuth, async (req, res) => {
  if (!evo) return res.status(503).json({ error: "Evolution API não configurada" });
  const ensureInstance = async () => {
    try { await evo.get(`/instance/connectionState/${EVOLUTION_INST}`); }
    catch { await evo.post(`/instance/create`, { instanceName: EVOLUTION_INST, qrcode: true, integration: "WHATSAPP-BAILEYS" }); }
  };
  try {
    await ensureInstance();
    const { data } = await evo.get(`/instance/connect/${EVOLUTION_INST}`);
    if (data.code) {
      res.json({ code: data.code, pairingCode: data.pairingCode });
    } else {
      // Instância não tem QR (pode já estar conectada ou em estado intermediário)
      const stateRes = await evo.get(`/instance/connectionState/${EVOLUTION_INST}`);
      const state = stateRes.data?.instance?.state;
      if (state === "open") {
        res.json({ connected: true, state });
      } else {
        // Estado desconhecido — forçar reconexão deletando e recriando
        await evo.delete(`/instance/delete/${EVOLUTION_INST}`).catch(() => {});
        await evo.post(`/instance/create`, { instanceName: EVOLUTION_INST, qrcode: true, integration: "WHATSAPP-BAILEYS" });
        const { data: data2 } = await evo.get(`/instance/connect/${EVOLUTION_INST}`);
        res.json({ code: data2.code, pairingCode: data2.pairingCode, state });
      }
    }
  } catch (err) {
    console.error("[whatsapp/qr]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
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
    // Fuso Brasil UTC-3: Railway roda em UTC, produtor está no Brasil
    const BRT = 3 * 60 * 60 * 1000;
    const nowBrt = new Date(now.getTime() - BRT);
    const todayStart = new Date(Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) + BRT).toISOString();
    const monthStart = new Date(Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), 1) + BRT).toISOString();

    const [salesMonth, salesToday, activeSubs, totalCustomers] = await Promise.all([
      supabase.from("sales")
        .select("amount,gross_amount,net_amount,asaas_fee,platform_fee,producer_amount")
        .eq("owner_id", uid).eq("status", "pago")
        .or(`payment_date.gte.${monthStart},and(payment_date.is.null,created_at.gte.${monthStart})`),
      supabase.from("sales")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", uid).eq("status", "pago")
        .gte("created_at", todayStart),
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

    res.set("Cache-Control", "no-store").json({
      receitaBrutaMes:   Math.round(receitaBrutaMes   * 100) / 100,
      receitaLiquidaMes: Math.round(receitaLiquidaMes * 100) / 100,
      taxasAsaasMes:     Math.round(taxasAsaasMes     * 100) / 100,
      taxaPlataformaMes: Math.round(taxaPlataformaMes * 100) / 100,
      receitaMes:        Math.round(receitaLiquidaMes * 100) / 100,
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
    const BRT    = 3 * 60 * 60 * 1000;
    const nowBrt = new Date(now.getTime() - BRT);
    let from;
    if      (period === "hoje")      from = new Date(Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) + BRT).toISOString();
    else if (period === "semana")    from = new Date(now.getTime() - 7  * 86400000).toISOString();
    else if (period === "mes")       from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    else if (period === "trimestre") from = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1).toISOString();
    else                             from = new Date(now.getFullYear(), 0, 1).toISOString();

    const { data } = await supabase.from("sales")
      .select("producer_amount,amount,payment_date,created_at")
      .eq("owner_id", uid).eq("status", "pago")
      .gte("created_at", from);

    const normalized = (data || []).map(s => ({
      amount:     Number(s.producer_amount || s.amount || 0),
      created_at: s.created_at,
    }));

    res.set("Cache-Control", "no-store").json({ sales: normalized });
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

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS PÚBLICAS — checkout próprio (sem autenticação)
// ══════════════════════════════════════════════════════════════════════════════

// Taxas Asaas (promo até 07/2026) — atualizar se mudarem
const ASAAS_RATES = {
  PIX:     { fixed: 0.99, pct: 0 },
  BOLETO:  { fixed: 0.99, pct: 0 },
  CC_1:    { fixed: 0.49, pct: 0.0199 }, // à vista
  CC_2_6:  { fixed: 0.49, pct: 0.0249 }, // 2-6x
  CC_7_12: { fixed: 0.49, pct: 0.0299 }, // 7-12x
};

function calcPublicPrice(basePrice, method, installments = 1) {
  const plat = Math.round(basePrice * PLATFORM_FEE_RATE * 100) / 100;
  let asaasFee = 0;
  if (method === "PIX")    asaasFee = ASAAS_RATES.PIX.fixed;
  if (method === "BOLETO") asaasFee = ASAAS_RATES.BOLETO.fixed;
  if (method === "CREDIT_CARD") {
    const r = installments <= 1 ? ASAAS_RATES.CC_1 :
              installments <= 6 ? ASAAS_RATES.CC_2_6 : ASAAS_RATES.CC_7_12;
    asaasFee = Math.round((basePrice * r.pct + r.fixed) * 100) / 100;
  }
  return {
    clientTotal:  Math.round((basePrice + plat + asaasFee) * 100) / 100,
    platformFee:  plat,
    asaasFee:     asaasFee,
    producerGets: basePrice,
  };
}

/** GET /api/public/products/:id — retorna config do produto (sem dados sensíveis) */
app.get("/api/public/products/:id", async (req, res) => {
  try {
    const { data: product, error } = await supabase.from("products")
      .select("id,name,description,price,billing_type,subscription_cycle")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error || !product) return res.status(404).json({ error: "Produto não encontrado" });
    res.json({
      id:               product.id,
      name:             product.name,
      description:      product.description,
      price:            Number(product.price),
      billingType:      product.billing_type,
      subscriptionCycle: product.subscription_cycle,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/public/checkout — cria customer + payment/subscription no Asaas */
app.post("/api/public/checkout", async (req, res) => {
  try {
    const { productId, name, email, phone, cpfCnpj, postalCode,
            addressNumber, method, installments = 1, birthday } = req.body;
    if (!productId || !name || !email || !cpfCnpj || !method) {
      return res.status(400).json({ error: "Campos obrigatórios: productId, name, email, cpfCnpj, method" });
    }

    // Busca produto
    const { data: product } = await supabase.from("products")
      .select("id,name,description,price,billing_type,subscription_cycle,owner_id")
      .eq("id", productId).maybeSingle();
    if (!product) return res.status(404).json({ error: "Produto não encontrado" });

    const basePrice = Number(product.price);
    const numInstallments = method === "CREDIT_CARD" ? Math.min(12, Math.max(1, Number(installments))) : 1;
    const { clientTotal, platformFee: pfee, asaasFee, producerGets } = calcPublicPrice(basePrice, method, numInstallments);

    // 1. Garante customer no Supabase (independente do Asaas)
    let customerId = null;
    const { data: existByEmail } = await supabase.from("customers")
      .select("id").eq("email", email).eq("owner_id", product.owner_id).maybeSingle();
    if (existByEmail) {
      customerId = existByEmail.id;
      await supabase.from("customers").update({ name, phone: phone || null }).eq("id", customerId);
    } else {
      const { data: newCust, error: custErr } = await supabase.from("customers")
        .insert({ name, email, phone: phone || null, owner_id: product.owner_id })
        .select("id").maybeSingle();
      if (custErr) console.error("[public/checkout] ERRO ao criar customer:", custErr.message, custErr.code, custErr.details);
      customerId = newCust?.id || null;
    }

    // 2. Cria customer no Asaas e vincula (sem bloquear o fluxo)
    let asaasCustomerId = null;
    try {
      const custPayload = { name, email, cpfCnpj };
      if (phone)         custPayload.mobilePhone = phone;
      if (postalCode)    custPayload.postalCode = postalCode.replace(/\D/g, "");
      if (birthday)      custPayload.birthDate = birthday;
      if (addressNumber) custPayload.addressNumber = addressNumber;
      const custResp = await asaas.post("/customers", custPayload);
      asaasCustomerId = custResp.data?.id || null;
      if (asaasCustomerId && customerId) {
        await supabase.from("customers").update({ asaas_customer_id: asaasCustomerId }).eq("id", customerId);
      }
    } catch(e) {
      console.warn("[public/checkout] falha ao criar customer no Asaas:", e.response?.data || e.message);
    }

    // 3. Cria payment ou subscription no Asaas
    const isRecurrent = product.billing_type === "RECURRENT";
    let chargeId = null, pixQrCode = null, pixCopyCola = null, boletoUrl = null, invoiceUrl = null;

    const saleId = require("crypto").randomUUID();
    const billingKind = isRecurrent ? "SUBSCRIPTION" : "ONE_TIME";

    const paymentBase = {
      customer:    asaasCustomerId,
      value:       clientTotal,
      description: product.name + (product.description ? ` — ${product.description}` : ""),
      externalReference: JSON.stringify({ saleId, type: billingKind }),
    };

    if (isRecurrent) {
      // Assinatura
      const cycle = product.subscription_cycle || "MONTHLY";
      const subResp = await asaas.post("/subscriptions", {
        ...paymentBase,
        billingType: method === "PIX" ? "PIX" : method === "BOLETO" ? "BOLETO" : "CREDIT_CARD",
        cycle,
        nextDueDate: new Date(Date.now() + 86400000).toISOString().split("T")[0],
      });
      chargeId = subResp.data?.id;
      boletoUrl = subResp.data?.bankSlipUrl;
    } else {
      // Pagamento único
      const payPayload = {
        ...paymentBase,
        billingType: method === "PIX" ? "PIX" : method === "BOLETO" ? "BOLETO" : "CREDIT_CARD",
        dueDate: new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0],
      };
      if (method === "CREDIT_CARD" && numInstallments > 1) {
        payPayload.installmentCount = numInstallments;
        payPayload.totalValue = clientTotal;
      }
      const payResp = await asaas.post("/payments", payPayload);
      chargeId = payResp.data?.id;
      boletoUrl = payResp.data?.bankSlipUrl;
      invoiceUrl = payResp.data?.invoiceUrl;

      // Busca QR PIX se necessário
      if (method === "PIX" && chargeId) {
        try {
          const pixResp = await asaas.get(`/payments/${chargeId}/pixQrCode`);
          pixQrCode   = pixResp.data?.encodedImage || null;
          pixCopyCola = pixResp.data?.payload || null;
        } catch(e) {
          console.warn("[public/checkout] falha ao buscar PIX QR:", e.message);
        }
      }
    }

    // 4. Salva sale pendente no Supabase (webhook vai atualizar status)
    const { error: saleErr } = await supabase.from("sales").insert({
      id:                saleId,
      product_id:        product.id,
      owner_id:          product.owner_id,
      customer_id:       customerId,
      amount:            clientTotal,
      gross_amount:      clientTotal,
      platform_fee:      pfee,
      asaas_fee:         asaasFee,
      producer_amount:   producerGets,
      billing_type:      method,
      installment_count: numInstallments,
      status:            "pendente",
      asaas_id:          chargeId,
      payment_date:      null,
    });
    if (saleErr) console.error("[public/checkout] ERRO ao criar sale:", saleErr.message, saleErr.code, saleErr.details);

    console.log("[public/checkout] chargeId:", chargeId, "| method:", method, "| customerId:", customerId);
    res.json({ chargeId, pixQrCode, pixCopyCola, boletoUrl, invoiceUrl, clientTotal });
  } catch (err) {
    console.error("[public/checkout] erro:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.description || err.message });
  }
});

/** GET /api/public/checkout/:chargeId/status — polling do status de pagamento */
app.get("/api/public/checkout/:chargeId/status", async (req, res) => {
  try {
    const { chargeId } = req.params;
    let status = "PENDING";
    try {
      const r = await asaas.get(`/payments/${chargeId}`);
      status = r.data?.status || "PENDING";
    } catch(e) {
      try {
        const r = await asaas.get(`/subscriptions/${chargeId}`);
        status = r.data?.status || "PENDING";
      } catch(e2) { /* ignora */ }
    }
    // Persiste confirmação no banco (não depender só do webhook)
    if (["CONFIRMED", "RECEIVED"].includes(status)) {
      await supabase.from("sales")
        .update({ status: "pago" })
        .eq("asaas_id", chargeId)
        .eq("status", "pendente");
    }
    res.json({ status });
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
      whatsapp:  !!(process.env.EVOLUTION_API_URL && !process.env.EVOLUTION_API_URL.includes("seudominio")),
    },
  });
});

// ── CRM: adicionar cliente manual ─────────────────────────────────────────────
app.post("/api/customers/add", requireAuth, async (req, res) => {
  const { name, phone, email, birthday } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Nome obrigatório" });
  const { data, error } = await supabase
    .from("customers")
    .insert({
      owner_id: req.user.id,
      name: name.trim(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      birthday: birthday || null,
      source: "manual",
      status: "lead",
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── CRM: importar lista de clientes via CSV ────────────────────────────────────
app.post("/api/customers/import", requireAuth, async (req, res) => {
  const { customers } = req.body;
  if (!Array.isArray(customers) || customers.length === 0)
    return res.status(400).json({ error: "Lista vazia" });

  const rows = customers
    .filter(c => c.name && c.name.trim())
    .map(c => ({
      owner_id: req.user.id,
      name:     c.name.trim(),
      phone:    c.phone?.trim() || null,
      email:    c.email?.trim() || null,
      source:   "manual",
      status:   "lead",
    }));

  if (!rows.length) return res.json({ inserted: 0 });

  // upsert por nome+owner — evita duplicatas exatas
  const { data, error } = await supabase
    .from("customers")
    .upsert(rows, { onConflict: "owner_id,phone", ignoreDuplicates: true })
    .select("id");

  if (error) {
    // fallback: insere um a um ignorando erros individuais
    let inserted = 0;
    for (const row of rows) {
      const { error: e } = await supabase.from("customers").insert(row);
      if (!e) inserted++;
    }
    return res.json({ inserted });
  }
  res.json({ inserted: data?.length || rows.length });
});

// ── CRM: entrada de lead via MiniChat (protegido por X-Owner-Key) ─────────────
const leadsRateMap = new Map();
app.post("/api/leads/create", async (req, res) => {
  const ownerKey = req.headers["x-owner-key"];
  if (!ownerKey) return res.status(401).json({ error: "X-Owner-Key ausente" });

  // Rate limit: 10 req/min por chave
  const now = Date.now();
  const entry = leadsRateMap.get(ownerKey) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  leadsRateMap.set(ownerKey, entry);
  if (entry.count > 10) return res.status(429).json({ error: "Limite de requisições atingido" });

  // Valida que o owner_key é um UUID existente em profiles
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", ownerKey)
    .single();
  if (pErr || !profile) return res.status(401).json({ error: "X-Owner-Key inválido" });

  const { name, phone, email } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Nome obrigatório" });

  const { data, error } = await supabase
    .from("customers")
    .upsert(
      {
        owner_id: profile.id,
        name: name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        source: "minichat",
        status: "lead",
      },
      { onConflict: "owner_id,phone", ignoreDuplicates: false }
    )
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── PATCH /api/customers/:id/status ──────────────────────────────────────────
app.patch("/api/customers/:id/status", requireAuth, async (req, res) => {
  const { status } = req.body;
  const allowed = ["lead", "cliente", "assinante"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Status inválido" });
  const { data, error } = await supabase
    .from("customers")
    .update({ status })
    .eq("id", req.params.id)
    .eq("owner_id", req.user.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── PATCH /api/customers/:id ─────────────────────────────────────────────────
app.patch("/api/customers/:id", requireAuth, async (req, res) => {
  const allowed = ['name','phone','email','birthday','notes','postal_code'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined && req.body[k] !== null && req.body[k] !== '') updates[k] = req.body[k];
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: "Nada para atualizar" });
  if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email))
    return res.status(400).json({ error: "Email inválido" });
  if (updates.phone && !/^\d{8,15}$/.test(updates.phone.replace(/\D/g,'')))
    return res.status(400).json({ error: "Telefone inválido" });
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("customers").update(updates)
    .eq("id", req.params.id).eq("owner_id", req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── POST /api/whatsapp/send-group ─────────────────────────────────────────────
app.post("/api/whatsapp/send-group", requireAuth, async (req, res) => {
  try {
  if (!evo) return res.status(503).json({ error: "Evolution API não configurada" });
  const { message, group } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "Mensagem vazia" });

  // Busca clientes do produtor filtrados por grupo
  let query = supabase.from("customers").select("id,phone,name").eq("owner_id", req.user.id);
  if (group && group !== "todos") {
    if (group === "cliente") query = query.or("status.eq.cliente,status.is.null");
    else query = query.eq("status", group);
  }
  const { data: customers, error: custErr } = await query;
  if (custErr) return res.status(500).json({ error: custErr.message });

  const excludedIds = Array.isArray(req.body.excludedIds) ? new Set(req.body.excludedIds) : new Set();
  const skipped = (customers || []).filter(c => !c.phone || excludedIds.has(c.id))
    .map(c => ({ name: c.name, reason: !c.phone ? 'no_phone' : 'excluded' }));
  const seenPhones = new Set();
  const withPhone = (customers || []).filter(c => {
    if (!c.phone || excludedIds.has(c.id)) return false;
    const normalized = c.phone.replace(/\D/g, '');
    if (seenPhones.has(normalized)) return false;
    seenPhones.add(normalized);
    return true;
  });
  let sent = 0, failed = 0;
  const log = [...skipped];

  // Envio em lote com concorrência máxima de 5
  const CHUNK = 5;
  for (let i = 0; i < withPhone.length; i += CHUNK) {
    await Promise.all(withPhone.slice(i, i + CHUNK).map(async c => {
      try {
        const r = await evo.post(`/message/sendText/${EVOLUTION_INST}`, {
          number: (n=>(n.startsWith("55")?n:"55"+n))(c.phone.replace(/\D/g,"")),
          text: message.replace(/\{nome\}/g, c.name || ""),
        });
        const providerId = r.data?.key?.id || null;
        await supabase.from("messages").insert({
          owner_id: req.user.id, customer_id: c.id,
          direction: "outbound", content: message, type: "text",
          group_target: group || "todos", status: "sent", provider_id: providerId,
        }).then(null, () => {}); // tabela pode não ter colunas v8 ainda
        log.push({ name: c.name, reason: 'sent' });
        sent++;
      } catch (e) {
        const errMsg = e.response?.data?.message || e.response?.data?.error || e.message;
        console.error(`[send-group] falha ${c.name}:`, errMsg);
        await supabase.from("messages").insert({
          owner_id: req.user.id, customer_id: c.id,
          direction: "outbound", content: message, type: "text",
          group_target: group || "todos", status: "failed",
          error_message: errMsg,
        }).then(null, () => {});
        log.push({ name: c.name, reason: errMsg });
        failed++;
      }
    }));
  }

  // Registra o disparo agregado (group_count)
  await supabase.from("messages").insert({
    owner_id: req.user.id, direction: "outbound", content: message, type: "text",
    group_target: group || "todos", group_count: sent, status: sent > 0 ? "sent" : "failed",
  }).then(null, () => {});

  res.json({ sent, failed, total: withPhone.length, log });
  } catch (e) {
    console.error('[send-group] crash:', e.message, e.stack);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

app.get("/api/whatsapp/pairing-code", requireAuth, async (req, res) => {
  if (!evo) return res.status(503).json({ error: "Evolution API não configurada" });
  const phone = (req.query.phone || "").replace(/\D/g, "");
  if (!phone) return res.status(400).json({ error: "Telefone obrigatório" });
  try {
    const { data } = await evo.get(`/instance/connect/${EVOLUTION_INST}`, { params: { phoneNumber: phone } });
    res.json({ pairingCode: data.pairingCode, code: data.code });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

app.get("/api/user/disparos", requireAuth, async (req, res) => {
  const { data } = await supabase.from("profiles").select("disparos").eq("id", req.user.id).single();
  res.json(data?.disparos || null);
});

app.patch("/api/user/disparos", requireAuth, async (req, res) => {
  const { data, error } = await supabase.from("profiles").update({ disparos: req.body }).eq("id", req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Tracking: receber visitas dos sites dos produtores ───────────────────────
// CORS aberto só nesta rota (sensor vem de domínios externos)
app.post("/api/track/visit", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
}, async (req, res) => {
  res.json({ ok: true }); // responde imediatamente para não travar o site
  try {
    const { user_id, domain, page, referrer, source, device } = req.body || {};
    if (!user_id) return;
    // valida que o user_id existe (evita lixo no banco)
    const { data: profile } = await supabase
      .from("profiles").select("id").eq("id", user_id).maybeSingle();
    if (!profile?.id) return;
    await supabase.from("visits").insert({
      owner_id: user_id,
      site_url: domain  || "",
      page:     page    || "/",
      referrer: referrer|| "",
      source:   source  || "direto",
      device:   device  || "unknown",
    }).then(null, e => console.warn("[track/visit]", e.message));
  } catch(e) { console.error("[track/visit]", e.message); }
});

// preflight CORS para o sensor
app.options("/api/track/visit", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

// ── Analytics: dados de visitas para a aba Máquina ───────────────────────────
app.get("/api/analytics/visits", requireAuth, async (req, res) => {
  const days  = Math.min(parseInt(req.query.days) || 30, 30);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data: rows } = await supabase
    .from("visits").select("created_at, source, device")
    .eq("owner_id", req.user.id).gte("created_at", since);
  if (!rows) return res.json({ total: 0, daily: [], sources: [] });

  // agrupamento diário
  const byDay = {};
  rows.forEach(r => {
    const d = r.created_at.slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  });
  // preenche os últimos N dias
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    daily.push({ date: d, count: byDay[d] || 0 });
  }

  // agrupamento por fonte
  const bySrc = {};
  rows.forEach(r => { bySrc[r.source] = (bySrc[r.source] || 0) + 1; });
  const total = rows.length;
  const sources = Object.entries(bySrc)
    .map(([src, cnt]) => ({ source: src, count: cnt, pct: total ? Math.round(cnt * 100 / total) : 0 }))
    .sort((a, b) => b.count - a.count);

  res.json({ total, daily, sources });
});

// ── Perfil do produtor: ler e salvar nome/empresa/avatar ──────────────────────
app.get("/api/user/profile", requireAuth, async (req, res) => {
  const { data } = await supabase.from("profiles")
    .select("name,company_name,avatar_url,email")
    .eq("id", req.user.id).single();
  res.json(data || {});
});

app.patch("/api/user/profile", requireAuth, async (req, res) => {
  const { name, company_name, avatar_url } = req.body;
  const updates = {};
  if (name        !== undefined) updates.name         = name?.trim()         || null;
  if (company_name!== undefined) updates.company_name = company_name?.trim() || null;
  if (avatar_url  !== undefined) updates.avatar_url   = avatar_url           || null;
  if (!Object.keys(updates).length) return res.json({ ok: true });
  const { error } = await supabase.from("profiles").update(updates).eq("id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, ...updates });
});

// ── Site do produtor: salvar/ler URL + checar status ─────────────────────────
app.get("/api/user/site", requireAuth, async (req, res) => {
  const { data } = await supabase.from("profiles").select("site_url").eq("id", req.user.id).single();
  res.json({ site_url: data?.site_url || null });
});

app.patch("/api/user/site", requireAuth, async (req, res) => {
  const { site_url } = req.body;
  const { error } = await supabase.from("profiles").update({ site_url }).eq("id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, site_url });
});

app.get("/api/site-status", requireAuth, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({ online: false });
  try {
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;
    const resp = await axios.get(fullUrl, { timeout: 5000, validateStatus: () => true });
    res.json({ online: resp.status < 500 });
  } catch {
    res.json({ online: false });
  }
});

// ── Evolution API: receber mensagens inbound ─────────────────────────────────
app.post("/api/whatsapp/inbound", async (req, res) => {
  res.json({ ok: true }); // responde imediatamente para não gerar retry
  try {
    const payload = req.body;
    // Evolution API v2 envia event + data.messages ou data como array
    const messages = payload?.data?.messages
      || (Array.isArray(payload?.data) ? payload.data : []);
    for (const msg of messages) {
      if (msg.key?.fromMe) continue;
      const remoteJid = msg.key?.remoteJid || "";
      if (remoteJid.endsWith("@g.us")) continue; // grupos WhatsApp, ignora
      const fromNumber = remoteJid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
      const content = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption || "";
      if (!content || !fromNumber) continue;
      if (!cachedOwnerId) {
        const { data: prof } = await supabase.from("profiles").select("id").limit(1).single();
        if (prof?.id) cachedOwnerId = prof.id;
        else { console.warn("[inbound] owner_id não disponível, msg de", fromNumber); continue; }
      }
      await supabase.from("messages").insert({
        owner_id:     cachedOwnerId,
        content,
        status:       "inbound",
        group_target: "_inbound_" + fromNumber,
        group_count:  0,
      }).then(null, e => console.warn("[inbound] insert:", e.message));
      console.log(`[inbound] ${fromNumber}: ${content.slice(0, 60)}`);
    }
  } catch(e) { console.error("[inbound]", e.message); }
});

async function syncAssinanteStatus() {
  try {
    const { data: subs } = await supabase.from("subscriptions").select("customer_id").eq("status", "ativo");
    if (!subs?.length) return;
    const ids = [...new Set(subs.map(s => s.customer_id).filter(Boolean))];
    const { error } = await supabase.from("customers").update({ status: "assinante" }).in("id", ids).neq("status", "assinante");
    if (error) console.warn("[syncAssinante]", error.message);
    else console.log(`[syncAssinante] ${ids.length} assinante(s) sincronizado(s)`);
  } catch(e) { console.warn("[syncAssinante]", e.message); }
}

async function setupEvolutionWebhook() {
  try {
    await evo.post(`/webhook/set/${EVOLUTION_INST}`, {
      url:              `${PUBLIC_URL}/api/whatsapp/inbound`,
      webhook_by_events: false,
      webhook_base64:   false,
      events:           ["MESSAGES_UPSERT"],
    });
    console.log("[evolution] webhook inbound configurado →", PUBLIC_URL);
  } catch(e) { console.warn("[evolution] webhook setup:", e.message); }
}

app.listen(PORT, () => {
  console.log(`\n🚀 JosephPay API rodando na porta ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
  syncAssinanteStatus();
  if (evo) setupEvolutionWebhook();
});
