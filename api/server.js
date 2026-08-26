try { require("dotenv").config(); } catch(e) {}
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
const crypto     = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { Resend }       = require("resend");
const nodemailer       = require("nodemailer");
const webpush          = require("web-push");

const app  = express();
const PORT = process.env.PORT || 3001;

// Sensor/track: CORS aberto para qualquer domínio de produtor.
// Deve ficar ANTES do cors() global para capturar o OPTIONS preflight primeiro.
app.options("/api/track/visit", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const ok =
      origin === process.env.FRONTEND_ORIGIN ||
      origin.endsWith(".vercel.app") ||
      origin.startsWith("http://localhost") ||
      origin === "https://josephpay.com" ||
      origin === "https://www.josephpay.com";
    cb(null, ok);
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// ── Supabase Admin Client (service role — NUNCA exponha ao browser) ──────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Resend (e-mail transacional) ───────────────────────────────────────────
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = "JosephPay <noreply@josephpay.com>";

function emailCustomer({ customerName, productTitle, grossAmount, paymentMethod, producerName }) {
  const valor = `R$ ${Number(grossAmount).toFixed(2).replace(".", ",")}`;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0D0D0D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0D0D0D;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D0D0D;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
<tr><td style="background:linear-gradient(135deg,#D4AF37,#B8962E);padding:28px 40px;text-align:center;">
  <div style="font-size:26px;font-weight:900;color:#0D0D0D;">JosephPay</div>
  <div style="font-size:11px;color:rgba(0,0,0,0.5);margin-top:3px;letter-spacing:1px;font-weight:600;">PAGAMENTOS INTELIGENTES</div>
</td></tr>
<tr><td style="padding:32px 40px 0;text-align:center;">
  <div style="width:56px;height:56px;background:linear-gradient(135deg,#D4AF37,#B8962E);border-radius:50%;display:inline-block;line-height:56px;font-size:26px;color:#0D0D0D;font-weight:900;">✓</div>
  <h1 style="color:#fff;font-size:22px;font-weight:800;margin:16px 0 8px;">Compra Confirmada!</h1>
  <p style="color:#888;font-size:14px;margin:0;">Olá, <strong style="color:#D4AF37;">${customerName}</strong> — seu pedido foi processado com sucesso.</p>
</td></tr>
<tr><td style="padding:24px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1A1A1A;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">
    <tr><td style="padding:16px 20px;border-bottom:1px solid #2a2a2a;">
      <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Produto</div>
      <div style="color:#fff;font-size:14px;font-weight:700;">${productTitle}</div>
    </td></tr>
    <tr><td style="padding:16px 20px;border-bottom:1px solid #2a2a2a;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Valor pago</div><div style="color:#D4AF37;font-size:20px;font-weight:900;">${valor}</div></td>
          <td style="text-align:right;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Método</div><div style="color:#fff;font-size:14px;font-weight:700;">${paymentMethod}</div></td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 20px;">
      <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Vendedor</div>
      <div style="color:#fff;font-size:14px;font-weight:700;">${producerName}</div>
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 40px 24px;">
  <div style="background:#111;border-left:3px solid #D4AF37;border-radius:0 8px 8px 0;padding:14px 18px;">
    <p style="color:#aaa;font-size:12px;margin:0;line-height:1.6;">Em caso de dúvidas, entre em contato diretamente com o vendedor. Este e-mail é uma confirmação automática da plataforma JosephPay.</p>
  </div>
</td></tr>
<tr><td style="background:#0A0A0A;padding:18px 40px;text-align:center;border-top:1px solid #1a1a1a;">
  <p style="color:#444;font-size:11px;margin:0;">© 2025 JosephPay · <a href="https://josephpay.com" style="color:#D4AF37;text-decoration:none;">josephpay.com</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function emailProducer({ producerName, productTitle, baseProductPrice, customerName, customerEmail, paymentMethod, paymentDate }) {
  const valor = `R$ ${Number(baseProductPrice).toFixed(2).replace(".", ",")}`;
  const dataFmt = paymentDate ? new Date(paymentDate).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0D0D0D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0D0D0D;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D0D0D;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
<tr><td style="background:linear-gradient(135deg,#D4AF37,#B8962E);padding:28px 40px;text-align:center;">
  <div style="font-size:26px;font-weight:900;color:#0D0D0D;">JosephPay</div>
  <div style="font-size:11px;color:rgba(0,0,0,0.5);margin-top:3px;letter-spacing:1px;font-weight:600;">PAGAMENTOS INTELIGENTES</div>
</td></tr>
<tr><td style="padding:32px 40px 0;text-align:center;">
  <div style="font-size:44px;line-height:1;">💰</div>
  <h1 style="color:#fff;font-size:22px;font-weight:800;margin:14px 0 8px;">Nova venda realizada!</h1>
  <p style="color:#888;font-size:14px;margin:0;">Parabéns, <strong style="color:#D4AF37;">${producerName}</strong> — você acabou de fechar mais uma venda.</p>
</td></tr>
<tr><td style="padding:24px 40px 0;">
  <div style="background:linear-gradient(135deg,#1a1500,#1a1200);border:1px solid #3a2e00;border-radius:12px;padding:22px;text-align:center;">
    <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Valor recebido</div>
    <div style="color:#D4AF37;font-size:36px;font-weight:900;letter-spacing:-1px;">${valor}</div>
  </div>
</td></tr>
<tr><td style="padding:16px 40px 28px;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1A1A1A;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">
    <tr><td style="padding:14px 20px;border-bottom:1px solid #2a2a2a;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="color:#888;font-size:13px;">Produto</td><td style="color:#fff;font-size:13px;font-weight:700;text-align:right;">${productTitle}</td></tr></table></td></tr>
    <tr><td style="padding:14px 20px;border-bottom:1px solid #2a2a2a;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="color:#888;font-size:13px;">Cliente</td><td style="color:#fff;font-size:13px;font-weight:700;text-align:right;">${customerName}</td></tr></table></td></tr>
    <tr><td style="padding:14px 20px;border-bottom:1px solid #2a2a2a;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="color:#888;font-size:13px;">E-mail do cliente</td><td style="color:#D4AF37;font-size:13px;font-weight:700;text-align:right;">${customerEmail}</td></tr></table></td></tr>
    <tr><td style="padding:14px 20px;border-bottom:1px solid #2a2a2a;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="color:#888;font-size:13px;">Método</td><td style="color:#fff;font-size:13px;font-weight:700;text-align:right;">${paymentMethod}</td></tr></table></td></tr>
    ${dataFmt ? `<tr><td style="padding:14px 20px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="color:#888;font-size:13px;">Data / Hora</td><td style="color:#fff;font-size:13px;font-weight:700;text-align:right;">${dataFmt}</td></tr></table></td></tr>` : ""}
  </table>
</td></tr>
<tr><td style="background:#0A0A0A;padding:18px 40px;text-align:center;border-top:1px solid #1a1a1a;">
  <p style="color:#444;font-size:11px;margin:0;">© 2025 JosephPay · <a href="https://josephpay.com" style="color:#D4AF37;text-decoration:none;">josephpay.com</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ── Mercado Pago client ────────────────────────────────────────────────────
const mp = axios.create({
  baseURL: "https://api.mercadopago.com",
  headers: {
    Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
    // X-Idempotency-Key NÃO entra aqui — gerado por request no interceptor abaixo
  },
});
// Gera chave de idempotência ÚNICA por requisição (chave estática causaria cache no MP)
mp.interceptors.request.use((config) => {
  config.headers["X-Idempotency-Key"] = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return config;
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

// ── Assinatura da plataforma (mensalidade dos usuários JosephPay) ─────────────
const PLATFORM_SUB_PRICE = 30;        // R$ por mês
const PLATFORM_SUB_DAYS  = 30;        // dias liberados por pagamento

// Retorna o estado de acesso do usuário. Acesso liberado enquanto now() < access_until.
// Fallback defensivo: se access_until vier nulo (usuário sem migração), concede
// 30 dias de cortesia a partir do cadastro — nunca bloqueia por acidente.
async function getAccess(userId) {
  try {
    const { data } = await supabase.from("profiles")
      .select("access_until, plan_status, created_at, mp_preapproval_id")
      .eq("id", userId).maybeSingle();
    if (!data) return { active: true, until: null, plan_status: "trial", hasCard: false };
    const until = data.access_until
      ? new Date(data.access_until)
      : new Date(new Date(data.created_at || Date.now()).getTime() + PLATFORM_SUB_DAYS * 86400000);
    return {
      active:      until.getTime() > Date.now(),
      until,
      plan_status: data.plan_status || "trial",
      hasCard:     !!data.mp_preapproval_id,
    };
  } catch (e) {
    console.warn("[getAccess]", e.message);
    return { active: true, until: null, plan_status: "trial", hasCard: false }; // fail-open
  }
}

// Estende (ou renova) o acesso do usuário em N dias a partir do maior entre agora
// e o vencimento atual — usado quando um pagamento de mensalidade é aprovado.
async function logMensalidade(userId, amount = PLATFORM_SUB_PRICE) {
  try {
    await supabase.from("platform_ledger").insert({
      type: "mensalidade", amount, related_profile_id: userId,
      description: "Mensalidade da plataforma",
    });
  } catch (e) { console.error("[logMensalidade]", e.message); }
}

async function grantPlatformAccess(userId, days = PLATFORM_SUB_DAYS) {
  try {
    const { data } = await supabase.from("profiles")
      .select("access_until").eq("id", userId).maybeSingle();
    const cur  = data?.access_until ? new Date(data.access_until) : null;
    const base = cur && cur.getTime() > Date.now() ? cur : new Date();
    const until = new Date(base.getTime() + days * 86400000);
    await supabase.from("profiles").update({
      access_until: until.toISOString(),
      plan_status:  "active",
    }).eq("id", userId);
    console.log(`[platform-sub] acesso liberado userId=${userId} até ${until.toISOString()}`);
    return until;
  } catch (e) {
    console.error("[grantPlatformAccess]", e.message);
  }
}

// Middleware: bloqueia funcionalidades premium se o mês grátis acabou e não há
// assinatura ativa. Responde 402 com uma mensagem para o front abrir o paywall.
async function requireSubscription(req, res, next) {
  // Admin não paga assinatura da própria plataforma
  if (req.user.user_metadata?.role === "admin") return next();
  const acc = await getAccess(req.user.id);
  if (acc.active) return next();
  return res.status(402).json({
    error:   "subscription_required",
    message: "Seu período grátis acabou. Assine o JosephPay por R$30/mês para continuar usando.",
    price:   PLATFORM_SUB_PRICE,
  });
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

  // Garante que o profile existe no banco — ignoreDuplicates=true: só insere se não existe,
  // nunca sobrescreve nome/avatar que o usuário já editou
  const profileData = {
    id:    user.id,
    name:  user.user_metadata?.name || user.email?.split("@")[0] || "Produtor",
    role:  user.user_metadata?.role || "client",
    email: user.email,
  };
  supabase.from("profiles")
    .upsert(profileData, { onConflict: "id", ignoreDuplicates: true })
    .then(({ error: e }) => {
      if (e) {
        const { email: _e, ...sem } = profileData;
        supabase.from("profiles").upsert(sem, { onConflict: "id", ignoreDuplicates: true }).then(() => {});
      }
    });

  // Marca atividade: último acesso + dia ativo (pra contar dias ativos no mês) — fire-and-forget
  supabase.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", user.id).then(() => {});
  supabase.from("login_events")
    .upsert({ user_id: user.id, day: new Date().toISOString().slice(0, 10) }, { onConflict: "user_id,day", ignoreDuplicates: true })
    .then(() => {});

  next();
}

// ── Middleware: exige role='admin' (rodar depois de requireAuth) ────────────
async function requireAdmin(req, res, next) {
  // Mesma fonte de verdade que o front usa pra decidir AdminPanel vs ClientPanel
  // (user_metadata.role) — profiles.role é só um espelho gravado uma única vez
  // no primeiro login e pode ficar desatualizado, então serve de fallback.
  if (req.user.user_metadata?.role === "admin") return next();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", req.user.id).single();
  if (profile?.role !== "admin") return res.status(403).json({ error: "Acesso restrito ao admin" });
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES PUSH — avisa o produtor no celular quando entra um interessado
// novo ou uma venda é paga, mesmo com o app fechado (Web Push padrão do
// navegador, sem depender de nenhum app de terceiro).
// ══════════════════════════════════════════════════════════════════════════════
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contato@josephpay.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

app.get("/api/push/vapid-public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: "Inscrição inválida" });
    }
    const { error } = await supabase.from("push_subscriptions").upsert({
      owner_id: req.user.id,
      endpoint: subscription.endpoint,
      p256dh:   subscription.keys.p256dh,
      auth:     subscription.keys.auth,
    }, { onConflict: "endpoint" });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/push/unsubscribe", requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: "endpoint ausente" });
  await supabase.from("push_subscriptions").delete().eq("owner_id", req.user.id).eq("endpoint", endpoint);
  res.json({ ok: true });
});

app.get("/api/push/status", requireAuth, async (req, res) => {
  const { count } = await supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("owner_id", req.user.id);
  res.json({ active: (count || 0) > 0 });
});

// Manda a notificação pra todos os aparelhos em que esse produtor ativou (pode ter
// mais de um — celular e computador, por exemplo). Fire-and-forget: nunca trava o
// fluxo principal (criar lead / confirmar venda) por causa de notificação.
async function sendPushToOwner(ownerId, { title, body, url }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !ownerId) return;
  try {
    const { data: subs } = await supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("owner_id", ownerId);
    if (!subs?.length) return;
    const payload = JSON.stringify({ title, body, url: url || "/" });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (err) {
        // 404/410 = inscrição expirada ou o usuário desativou no navegador — limpa do banco.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          console.warn("[push] falha ao enviar:", err.statusCode || err.message);
        }
      }
    }));
  } catch (err) {
    console.error("[push/send]", err.message);
  }
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
// Núcleo de criação de produto, reaproveitado tanto pelo produtor (dono cria pra si)
// quanto pelo admin (cria em nome de um produtor específico).
async function createProductForOwner(ownerId, body) {
  const { name, description, price, billingType = "UNDEFINED", subscriptionCycle = "MONTHLY",
          upsellUrl, downsellUrl, obrigadoUrl, gtmId } = body;
  if (!name || !price) return { status: 400, error: "Nome e preço são obrigatórios" };

  const basePrice   = Math.round(Number(price) * 100) / 100;
  const clientPrice = Math.round(basePrice * (1 + PLATFORM_FEE_RATE) * 100) / 100;
  const isRecurrent = billingType === "RECURRENT";

  const { data: product, error: dbErr } = await supabase.from("products").insert({
    name,
    description:        description || "",
    price:              basePrice,
    asaas_price:        clientPrice,
    asaas_link_id:      "",
    status:             "ativo",
    owner_id:           ownerId,
    url:                "",
    billing_type:       billingType || "UNDEFINED",
    subscription_cycle: isRecurrent ? subscriptionCycle : null,
    upsell_url:         upsellUrl   || null,
    downsell_url:       downsellUrl || null,
    obrigado_url:       obrigadoUrl || null,
    gtm_id:             gtmId       || null,
  }).select().single();

  if (dbErr) {
    console.error("[createProductForOwner] erro Supabase:", dbErr.message);
    return { status: 500, error: `Erro ao salvar produto: ${dbErr.message}` };
  }

  const prefPayload = {
    items: [{
      title:       name,
      description: description || name,
      quantity:    1,
      unit_price:  clientPrice,
      currency_id: "BRL",
    }],
    external_reference: JSON.stringify({ ownerId, productId: product.id }),
    notification_url:   `${PUBLIC_URL}/api/mp/webhook`,
    payment_methods: {
      installments: isRecurrent ? 1 : 12,
    },
    statement_descriptor: "JosephPay",
  };

  let paymentUrl = "";
  let mpPrefId   = "";

  try {
    const resp = await mp.post("/checkout/preferences", prefPayload);
    mpPrefId   = resp.data.id || "";
    paymentUrl = resp.data.init_point || resp.data.sandbox_init_point || "";
    console.log(`[createProductForOwner] MP preference criada id=${mpPrefId} | titulo=${resp.data.items?.[0]?.title} | url=${paymentUrl}`);
  } catch (mpErr) {
    const errMsg = mpErr.response?.data?.message || mpErr.message;
    console.error("[createProductForOwner] ERRO MP:", JSON.stringify(mpErr.response?.data));
    await supabase.from("products").delete().eq("id", product.id);
    return { status: 400, error: `Não foi possível criar o link no Mercado Pago: ${errMsg}` };
  }

  if (!mpPrefId) {
    await supabase.from("products").delete().eq("id", product.id);
    return { status: 400, error: "Mercado Pago retornou resposta sem ID. Verifique os logs." };
  }

  await supabase.from("products").update({
    asaas_link_id: mpPrefId,
    url:           paymentUrl,
  }).eq("id", product.id);
  product.asaas_link_id = mpPrefId;
  product.url           = paymentUrl;

  console.log(`[createProductForOwner] "${name}" salvo id=${product.id} owner=${ownerId} — base R$${basePrice}, cliente R$${clientPrice}`);
  return { status: 200, product, paymentUrl, mpPrefId };
}

app.post("/api/products/create", requireAuth, async (req, res) => {
  try {
    const r = await createProductForOwner(req.user.id, req.body);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ product: r.product, paymentUrl: r.paymentUrl, asaasLinkId: r.mpPrefId });
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
 * PATCH /api/products/:id/funnel
 * Atualiza upsell_url e downsell_url de um produto existente.
 * downsell_url só é aceito se upsell_url for fornecido.
 */
app.patch("/api/products/:id/funnel", requireAuth, async (req, res) => {
  try {
    const { upsellUrl, downsellUrl, obrigadoUrl, gtmId } = req.body;
    const upsell   = upsellUrl   ? String(upsellUrl).trim()   : null;
    const downsell = upsell && downsellUrl ? String(downsellUrl).trim() : null;
    const obrigado = obrigadoUrl ? String(obrigadoUrl).trim() : null;
    const gtm      = gtmId       ? String(gtmId).trim()       : null;
    const { error } = await supabase
      .from("products")
      .update({ upsell_url: upsell, downsell_url: downsell, obrigado_url: obrigado, gtm_id: gtm })
      .eq("id", req.params.id)
      .eq("owner_id", req.user.id);
    if (error) throw error;
    res.json({ success: true, upsellUrl: upsell, downsellUrl: downsell, obrigadoUrl: obrigado, gtmId: gtm });
  } catch (err) {
    console.error("[products/funnel]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/products/:id/sync
 * Sincroniza produto com dados reais do Mercado Pago (preference).
 */
app.get("/api/products/:id/sync", requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { data: product } = await supabase.from("products")
      .select("id,asaas_link_id,url").eq("id", req.params.id).eq("owner_id", uid).maybeSingle();
    if (!product?.asaas_link_id) return res.status(404).json({ error: "Produto não encontrado" });

    const { data: pref } = await mp.get(`/checkout/preferences/${product.asaas_link_id}`);
    const freshUrl = pref?.init_point || pref?.sandbox_init_point || product.url;

    if (freshUrl && freshUrl !== product.url) {
      await supabase.from("products").update({ url: freshUrl }).eq("id", product.id);
    }

    res.json({
      asaas_link_id: product.asaas_link_id,
      active:        pref?.active ?? true,
      url:           freshUrl,
      value:         pref?.items?.[0]?.unit_price,
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
 * Cria cobrança avulsa via Mercado Pago (mantém path para compatibilidade).
 */
app.post("/api/asaas/checkout", requireAuth, async (req, res) => {
  try {
    const { productId, amount, description, customer } = req.body;
    const saleId = require("crypto").randomUUID();

    const pref = await mp.post("/checkout/preferences", {
      items: [{ title: description || "JosephPay", quantity: 1, unit_price: Number(amount), currency_id: "BRL" }],
      payer: customer?.email ? { name: customer.name, email: customer.email } : undefined,
      external_reference: JSON.stringify({ saleId, type: "ONE_TIME" }),
      notification_url: `${PUBLIC_URL}/api/mp/webhook`,
    });

    const chargeId  = pref.data.id;
    const paymentUrl = pref.data.init_point || pref.data.sandbox_init_point;

    await supabase.from("sales").insert({
      id: saleId, product_id: productId, owner_id: req.user.id,
      amount, gross_amount: amount, status: "pendente", asaas_id: chargeId,
    });

    res.json({ paymentUrl, chargeId });
  } catch (err) {
    console.error("[asaas/checkout]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
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

    // Registra saque no banco — MP Sandbox não processa saques reais
    const transferId = "mp_withdrawal_" + Date.now();
    await supabase.from("withdrawals").insert({
      owner_id: uid,
      amount,
      status:   "processando",
      asaas_id: transferId,
      pix_key:  pixKey,
    });

    res.json({ status: "processando", transferId });
  } catch (err) {
    console.error("[asaas/withdraw]", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/asaas/webhook
 * Recebe eventos do Asaas.
 * Configure no painel Asaas → Configurações → Webhooks:
 *   URL: https://josephpay-production.up.railway.app/api/asaas/webhook
 */
// Webhook Asaas legado — mantido vazio para não quebrar configurações antigas
app.post("/api/asaas/webhook", async (req, res) => res.json({ received: true }));

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK — MERCADO PAGO
// Configure no painel MP Developers → Webhooks:
//   URL: https://josephpay-production.up.railway.app/api/mp/webhook
//   Eventos: payment (created, updated)
// ══════════════════════════════════════════════════════════════════════════════
app.post("/api/mp/webhook", async (req, res) => {
  res.json({ received: true }); // responde imediatamente para evitar retry do MP
  try {
    const { type, action, data: eventData } = req.body;
    console.log(`[mp/webhook] ✓ chegou — type=${type} action=${action} id=${eventData?.id} live=${req.body.live_mode}`);

    // ── ASSINATURA DA PLATAFORMA — cobrança recorrente do cartão (Mercado Pago) ──
    // Cada mês que o MP cobra o cartão do usuário chega aqui e renova o acesso +30 dias.
    if (type === "subscription_authorized_payment" && eventData?.id) {
      try {
        const { data: ap } = await mp.get(`/authorized_payments/${eventData.id}`);
        console.log("[mp/webhook] sub_payment status:", ap.status, "preapproval:", ap.preapproval_id);
        if (ap.status === "processed" || ap.payment?.status === "approved") {
          const { data: prof } = await supabase.from("profiles")
            .select("id").eq("mp_preapproval_id", ap.preapproval_id).maybeSingle();
          if (prof) { await grantPlatformAccess(prof.id, PLATFORM_SUB_DAYS); await logMensalidade(prof.id); }
        }
      } catch (e) { console.error("[mp/webhook] sub_payment erro:", e.message); }
      return;
    }

    // ── ASSINATURA DA PLATAFORMA — mudança de status (autorizada / cancelada) ──
    if (type === "subscription_preapproval" && eventData?.id) {
      try {
        const { data: pre } = await mp.get(`/preapproval/${eventData.id}`);
        console.log("[mp/webhook] preapproval status:", pre.status);
        const { data: prof } = await supabase.from("profiles")
          .select("id").eq("mp_preapproval_id", eventData.id).maybeSingle();
        if (prof) {
          if (pre.status === "authorized") {
            // Assinatura ativa com 1º mês grátis — garante que o acesso não expire durante o trial
            await grantPlatformAccess(prof.id, PLATFORM_SUB_DAYS);
          } else if (pre.status === "cancelled" || pre.status === "paused") {
            await supabase.from("profiles")
              .update({ plan_status: "canceled" }).eq("id", prof.id);
          }
        }
      } catch (e) { console.error("[mp/webhook] preapproval erro:", e.message); }
      return;
    }

    if (type !== "payment" || !eventData?.id) return;

    // Busca detalhes reais do pagamento no MP
    const { data: payment } = await mp.get(`/v1/payments/${eventData.id}`);
    console.log("[mp/webhook] status:", payment.status, "ref:", payment.external_reference);

    // ── ASSINATURA DA PLATAFORMA — pagamento avulso via PIX (mensalidade manual) ──
    // external_reference = {"kind":"PLATFORM_SUB","ownerId":"..."} → libera +30 dias na hora.
    // Interceptado ANTES da busca de sale para não ser tratado como venda de produto.
    try {
      const subRef = JSON.parse(payment.external_reference || "{}");
      if (subRef.kind === "PLATFORM_SUB" && subRef.ownerId) {
        if (payment.status === "approved") {
          await grantPlatformAccess(subRef.ownerId, PLATFORM_SUB_DAYS);
          await logMensalidade(subRef.ownerId, Number(payment.transaction_amount) || PLATFORM_SUB_PRICE);
        }
        return; // não é uma venda de produto — encerra aqui
      }
    } catch { /* external_reference não é JSON — segue fluxo normal de venda */ }

    // ── Localiza a sale pendente (3 estratégias, em ordem de prioridade) ─────────
    const mpPaymentId = String(payment.id);
    const SALE_FIELDS = "id,status,customer_id,owner_id,product_id";

    // 1. Pelo payment ID (já foi processado antes — proteção contra duplicata)
    const { data: existingSale } = await supabase.from("sales")
      .select(SALE_FIELDS).eq("asaas_id", mpPaymentId).maybeSingle();

    // 2. Pelo saleId no external_reference (PIX / Boleto / CARTÃO novo fluxo)
    //    CARTÃO: preference criada por checkout com external_reference = {"saleId":"...","type":"..."}
    //    PIX/Boleto: pagamento direto MP com mesmo external_reference
    let saleByRef = null;
    if (!existingSale && payment.external_reference) {
      try {
        const ref = JSON.parse(payment.external_reference);
        console.log("[mp/webhook] ext_ref parsed:", JSON.stringify(ref), "| saleId:", ref?.saleId ?? "AUSENTE");
        if (ref?.saleId) {
          const { data } = await supabase.from("sales")
            .select(SALE_FIELDS).eq("id", ref.saleId).maybeSingle();
          saleByRef = data;
          console.log("[mp/webhook] strategy2 (saleId):", saleByRef?.id ?? "não encontrada");
        }
      } catch { /* external_reference não é JSON válido */ }
    }

    // 3. Fallback: pelo preference_id (CARTÃO — compras antigas sem saleId no external_reference)
    let saleByPrefId = null;
    if (!existingSale && !saleByRef && payment.preference_id) {
      const { data: rows } = await supabase.from("sales")
        .select(SALE_FIELDS)
        .eq("asaas_id", payment.preference_id)
        .eq("status", "pendente")
        .order("created_at", { ascending: false })
        .limit(1);
      saleByPrefId = rows?.[0] ?? null;
      console.log("[mp/webhook] strategy3 (pref_id):", saleByPrefId?.id ?? "não encontrada");
    }

    const targetSale = existingSale || saleByRef || saleByPrefId;
    console.log("[mp/webhook] target:", targetSale?.id ?? "NENHUMA — nenhuma strategy achou a sale");

    if (payment.status === "approved") {
      const grossAmount  = Number(payment.transaction_amount || 0);
      const mpFee        = (payment.fee_details || []).reduce((a, f) => a + Number(f.amount || 0), 0);
      const netAmount    = Math.max(0, grossAmount - mpFee);
      const { platformFee, asaasFee, producerAmount } = calcFees(grossAmount, netAmount);
      const paymentDate  = payment.date_approved || new Date().toISOString();
      const billingType  = payment.payment_type_id?.toUpperCase() || "UNKNOWN";

      if (!targetSale) {
        // Sale pendente não encontrada — não criar duplicata
        console.error("[mp/webhook] SALE NÃO ENCONTRADA — preference_id:", payment.preference_id, "| payment_id:", mpPaymentId, "| ref:", payment.external_reference);
        return;
      }

      // Busca preço base do produto para garantir que produtor recebe 100%
      // (taxas MP e plataforma são sempre do comprador — já embutidas no clientTotal)
      const { data: prod } = await supabase.from("products")
        .select("price, title").eq("id", targetSale.product_id).maybeSingle();
      const baseProductPrice = prod?.price ?? grossAmount;

      // Atualiza sale existente (criada no checkout)
      await supabase.from("sales").update({
        status:          "pago",
        asaas_id:        mpPaymentId,
        asaas_fee:       mpFee,
        net_amount:      netAmount,
        producer_amount: baseProductPrice,
        platform_fee:    platformFee,
        billing_type:    billingType,
        payment_date:    paymentDate,
      }).eq("id", targetSale.id);
      console.log(`[mp/webhook] sale ${targetSale.id} paga | produtor=R$${baseProductPrice} | mp_fee=R$${mpFee} | customer=${targetSale.customer_id}`);
      await updateCustomerStats(targetSale.customer_id);
      sendPushToOwner(targetSale.owner_id, {
        title: "Nova venda! 🎉",
        body:  `R$ ${Number(baseProductPrice).toFixed(2).replace(".", ",")} — ${prod?.title || "Produto"}`,
        url:   "/",
      });

      // ── Stape sGTM relay para conversão server-side (fire-and-forget) ──
      // Manda o objeto completo do MP (resultado do GET /v1/payments/{id})
      // para o webhook do Stape processar no GTM server-side.
      if (STAPE_WEBHOOK_URL) {
        fetch(STAPE_WEBHOOK_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payment),
        }).catch(e => console.warn("[stape] relay erro:", e.message));
      }

      // ── E-mails de notificação (fire-and-forget — falha nunca afeta o webhook) ──
      (async () => {
        try {
          if (!process.env.RESEND_API_KEY) return;
          const paymentMethodLabel = billingType.includes("CREDIT") ? "Cartão de Crédito" : billingType.includes("DEBIT") ? "Cartão de Débito" : "PIX";
          const productTitle = prod?.title || "Produto";
          const customerEmail = payment.payer?.email;
          const customerName  = [payment.payer?.first_name, payment.payer?.last_name].filter(Boolean).join(" ") || "Cliente";
          const { data: { user: producerUser } } = await supabase.auth.admin.getUserById(targetSale.owner_id);
          const producerEmail = producerUser?.email;
          const producerName  = producerUser?.user_metadata?.name || producerUser?.email?.split("@")[0] || "Produtor";
          await Promise.all([
            customerEmail ? resend.emails.send({
              from:    FROM_EMAIL,
              to:      customerEmail,
              subject: `Compra confirmada — ${productTitle}`,
              html:    emailCustomer({ customerName, productTitle, grossAmount, paymentMethod: paymentMethodLabel, producerName }),
            }) : null,
            producerEmail ? resend.emails.send({
              from:    FROM_EMAIL,
              to:      producerEmail,
              subject: `💰 Nova venda — ${productTitle} · R$ ${Number(baseProductPrice).toFixed(2).replace(".", ",")}`,
              html:    emailProducer({ producerName, productTitle, baseProductPrice, customerName, customerEmail: customerEmail || "—", paymentMethod: paymentMethodLabel, paymentDate }),
            }) : null,
          ].filter(Boolean));
          console.log(`[email] enviados para cliente=${customerEmail} e produtor=${producerEmail}`);
        } catch(e) { console.warn("[email] erro:", e.message); }
      })();

    } else if (payment.status === "refunded" || payment.status === "cancelled") {
      if (targetSale) {
        await supabase.from("sales")
          .update({ status: "estornado", platform_fee: 0, producer_amount: 0, asaas_fee: 0 })
          .eq("id", targetSale.id);
      }
    }

  } catch(e) { console.error("[mp/webhook] erro:", e.message); }
});

/**
 * GET /api/asaas/balance — retorna saldo interno do produtor (calculado do banco)
 */
app.get("/api/asaas/balance", requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [{ data: sales }, { data: withdrawals }] = await Promise.all([
      supabase.from("sales").select("producer_amount,amount").eq("owner_id", uid).eq("status", "pago"),
      supabase.from("withdrawals").select("amount,status").eq("owner_id", uid).in("status", ["processando","concluido"]),
    ]);
    const totalProducer  = (sales || []).reduce((a, s) => a + Number(s.producer_amount ?? s.amount), 0);
    const totalWithdrawn = (withdrawals || []).reduce((a, w) => a + Number(w.amount), 0);
    res.json({ balance: Math.max(0, totalProducer - totalWithdrawn) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Teste de e-mail (não toca em nada crítico — dados fictícios via Resend real) ──
app.get("/api/test-email", async (req, res) => {
  const to = req.query.to;
  if (!to) return res.status(400).json({ error: "Passe ?to=seuemail@gmail.com" });
  if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: "RESEND_API_KEY não configurada" });
  try {
    const [r1, r2] = await Promise.all([
      resend.emails.send({
        from:    FROM_EMAIL,
        to,
        subject: "[TESTE] Compra confirmada — Consultoria Premium",
        html:    emailCustomer({ customerName: "João Silva", productTitle: "Consultoria Premium 1:1", grossAmount: 330, paymentMethod: "PIX", producerName: "Luís Henrique" }),
      }),
      resend.emails.send({
        from:    FROM_EMAIL,
        to,
        subject: "[TESTE] 💰 Nova venda — Consultoria Premium · R$ 300,00",
        html:    emailProducer({ producerName: "Luís Henrique", productTitle: "Consultoria Premium 1:1", baseProductPrice: 300, customerName: "João Silva", customerEmail: "joao@gmail.com", paymentMethod: "PIX", paymentDate: new Date().toISOString() }),
      }),
    ]);
    res.json({ ok: true, cliente: r1, produtor: r2 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — CHAT IA (cadeia de fallback: várias keys Groq → Anthropic)
// ══════════════════════════════════════════════════════════════════════════════

// Suporta várias keys da Groq (ex: de contas free diferentes) separadas por vírgula
// em GROQ_API_KEYS, ou as antigas GROQ_API_KEY / GROQ_API_KEY_1..N — tudo somado num só pool.
const GROQ_KEYS = [
  ...(process.env.GROQ_API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean),
  ...Object.keys(process.env)
    .filter(k => /^GROQ_API_KEY(_\d+)?$/.test(k))
    .map(k => process.env[k]).filter(Boolean),
];
const CHAT_TIMEOUT_MS = 8000;

async function callGroq(key, systemPrompt, messages) {
  const r = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    { model: "openai/gpt-oss-20b", max_tokens: 1024,
      messages: [{ role: "system", content: systemPrompt }, ...messages] },
    { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: CHAT_TIMEOUT_MS }
  );
  return r.data.choices[0].message.content;
}

async function callAnthropic(systemPrompt, messages) {
  const r = await axios.post(
    "https://api.anthropic.com/v1/messages",
    { model: "claude-haiku-4-5-20251001", max_tokens: 1024, system: systemPrompt, messages },
    { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, timeout: CHAT_TIMEOUT_MS }
  );
  return r.data.content[0].text;
}

// IA proativa: responde com base na operação real do produtor (vendas, clientes, saldo, afiliados).
// Cache curto por produtor pra não bater no banco a cada mensagem (simula "memória" recente).
const opContextCache = new Map(); // uid -> { text, ts }
const OP_CONTEXT_TTL_MS = 5 * 60 * 1000;

async function getOperationContext(uid) {
  const cached = opContextCache.get(uid);
  if (cached && Date.now() - cached.ts < OP_CONTEXT_TTL_MS) return cached.text;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [salesMonth, salesToday, totalCustomers, activeSubs, products, balance] = await Promise.all([
    supabase.from("sales").select("amount,producer_amount").eq("owner_id", uid).eq("status", "pago").gte("created_at", monthStart),
    supabase.from("sales").select("id", { count: "exact", head: true }).eq("owner_id", uid).eq("status", "pago").gte("created_at", todayStart),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("owner_id", uid),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("owner_id", uid).eq("status", "ativo"),
    supabase.from("products").select("id").eq("owner_id", uid),
    supabase.from("withdrawals").select("amount,status").eq("owner_id", uid).in("status", ["processando", "concluido"]),
  ]);

  const sales = salesMonth.data || [];
  const receitaMes = sales.reduce((a, s) => a + Number(s.producer_amount || s.amount || 0), 0);
  const productIds = (products.data || []).map(p => p.id);
  let afiliadosAtivos = 0;
  if (productIds.length) {
    const { count } = await supabase.from("affiliates").select("id", { count: "exact", head: true }).in("product_id", productIds).eq("status", "ativo");
    afiliadosAtivos = count || 0;
  }
  const totalWithdrawn = (balance.data || []).reduce((a, w) => a + Number(w.amount || 0), 0);
  const saldo = Math.max(0, receitaMes - totalWithdrawn);

  const text = `Dados reais da operação deste produtor (use para responder com precisão, sem inventar números):
- Receita líquida do mês: R$ ${receitaMes.toFixed(2)}
- Vendas pagas hoje: ${salesToday.count || 0}
- Total de clientes: ${totalCustomers.count || 0}
- Assinaturas ativas: ${activeSubs.count || 0}
- Afiliados ativos: ${afiliadosAtivos}
- Saldo disponível para sacar: R$ ${saldo.toFixed(2)}`;

  opContextCache.set(uid, { text, ts: Date.now() });
  return text;
}

app.post("/api/chat", requireAuth, requireSubscription, async (req, res) => {
  const uid = req.user.id;
  try {
    const { messages, productContext } = req.body;
    const opContext = await getOperationContext(uid).catch(() => "");
    const systemPrompt = `Você é o assistente de IA da JosephPay, especializado em marketing digital, vendas online e infoprodutos.
Você ajuda produtores a crescerem suas vendas, gerenciar afiliados e otimizar suas estratégias.
Seja proativo: aponte oportunidades e próximos passos mesmo sem o produtor perguntar diretamente.
${productContext ? `Contexto do produto: ${productContext}` : ""}
${opContext}
Responda sempre em português brasileiro, de forma direta e prática.`;

    const chatMessages = messages.map(m => ({ role: m.role, content: m.content }));

    let reply = null, lastErr = null;
    for (const key of GROQ_KEYS) {
      try { reply = await callGroq(key, systemPrompt, chatMessages); break; }
      catch (e) { lastErr = e; console.warn("[chat] groq key falhou, tentando próxima:", e.response?.data?.error?.message || e.message); }
    }
    if (reply === null && process.env.ANTHROPIC_API_KEY) {
      try { reply = await callAnthropic(systemPrompt, chatMessages); }
      catch (e) { lastErr = e; console.error("[chat] anthropic falhou:", e.response?.data || e.message); }
    }
    if (reply === null) throw lastErr || new Error("Nenhum provedor de IA configurado");

    res.json({ reply });
  } catch (err) {
    console.error("[chat]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — ASSINATURA DA PLATAFORMA (mensalidade dos usuários JosephPay)
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/subscription/status — estado da assinatura do usuário logado */
app.get("/api/subscription/status", requireAuth, async (req, res) => {
  const acc = await getAccess(req.user.id);
  res.json({
    active:      acc.active,
    until:       acc.until,
    plan_status: acc.plan_status,
    hasCard:     acc.hasCard,
    price:       PLATFORM_SUB_PRICE,
    daysLeft:    acc.until ? Math.max(0, Math.ceil((acc.until.getTime() - Date.now()) / 86400000)) : null,
  });
});

/** POST /api/subscription/pix — gera um PIX de R$30 (mensalidade avulsa/manual).
 *  Ao pagar, o webhook libera +30 dias na hora. Ideal para quem não usa cartão. */
app.post("/api/subscription/pix", requireAuth, async (req, res) => {
  try {
    const { cpf, name } = req.body;
    if (!cpf || cpf.replace(/\D/g, "").length < 11) {
      return res.status(400).json({ error: "CPF é obrigatório para gerar o PIX." });
    }
    const payerName = (name || req.user.user_metadata?.name || req.user.email?.split("@")[0] || "Usuário").trim();
    const parts = payerName.split(" ");
    const payResp = await mp.post("/v1/payments", {
      transaction_amount: PLATFORM_SUB_PRICE,
      payment_method_id:  "pix",
      description:        "JosephPay — Mensalidade",
      external_reference: JSON.stringify({ kind: "PLATFORM_SUB", ownerId: req.user.id }),
      notification_url:   `${PUBLIC_URL}/api/mp/webhook`,
      installments:       1,
      payer: {
        email:          req.user.email,
        first_name:     parts[0],
        last_name:      parts.slice(1).join(" ") || parts[0],
        identification: { type: "CPF", number: cpf.replace(/\D/g, "") },
      },
    });
    res.json({
      chargeId:    String(payResp.data.id),
      pixQrCode:   payResp.data.point_of_interaction?.transaction_data?.qr_code_base64 || null,
      pixCopyCola: payResp.data.point_of_interaction?.transaction_data?.qr_code || null,
    });
  } catch (err) {
    console.error("[subscription/pix]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

/** POST /api/subscription/card — cria assinatura recorrente no cartão (Mercado Pago
 *  Assinaturas / preapproval) com 1º MÊS GRÁTIS e depois R$30/mês automático.
 *  O cartão fica no cofre do Mercado Pago — nunca passa pelo nosso servidor. */
app.post("/api/subscription/card", requireAuth, async (req, res) => {
  try {
    const pre = await mp.post("/preapproval", {
      reason:         "JosephPay — Mensalidade",
      payer_email:    req.user.email,
      status:         "pending",
      back_url:       `${FRONTEND_URL}/?sub=ok`,
      external_reference: JSON.stringify({ kind: "PLATFORM_SUB", ownerId: req.user.id }),
      auto_recurring: {
        frequency:          1,
        frequency_type:     "months",
        transaction_amount: PLATFORM_SUB_PRICE,
        currency_id:        "BRL",
        free_trial:         { frequency: 1, frequency_type: "months" }, // 1º mês grátis
      },
    });
    // Guarda o id da assinatura para casar com os webhooks de cobrança recorrente
    await supabase.from("profiles")
      .update({ mp_preapproval_id: String(pre.data.id) }).eq("id", req.user.id);
    res.json({ init_point: pre.data.init_point || pre.data.sandbox_init_point, preapprovalId: String(pre.data.id) });
  } catch (err) {
    console.error("[subscription/card]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — WHATSAPP (Evolution API)
// ══════════════════════════════════════════════════════════════════════════════

const EVOLUTION_BASE = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY  = process.env.EVOLUTION_API_KEY;
const PUBLIC_URL     = process.env.PUBLIC_URL || "https://josephpay-production.up.railway.app";
const FRONTEND_URL   = process.env.FRONTEND_URL || "https://josephpay.com";
const N8N_WEBHOOK_URL   = process.env.N8N_WEBHOOK_URL   || null;
const STAPE_WEBHOOK_URL = process.env.STAPE_WEBHOOK_URL || null;

const evo = EVOLUTION_BASE && !EVOLUTION_BASE.includes("seudominio") ? axios.create({
  baseURL: EVOLUTION_BASE,
  headers: { apikey: EVOLUTION_KEY },
  timeout: 20000,
}) : null;

// Retorna a instância WhatsApp do usuário (cria e salva no perfil se ainda não existir)
async function getUserInst(userId) {
  const { data } = await supabase.from("profiles").select("whatsapp_instance").eq("id", userId).single();
  if (data?.whatsapp_instance) return data.whatsapp_instance;
  const inst = "jp_" + userId.replace(/-/g, "").slice(0, 8);
  await supabase.from("profiles").update({ whatsapp_instance: inst }).eq("id", userId);
  return inst;
}

app.get("/api/whatsapp/status", requireAuth, async (req, res) => {
  if (!evo) return res.json({ connected: false, reason: "Evolution API não configurada" });
  try {
    const inst = await getUserInst(req.user.id);
    const { data } = await evo.get(`/instance/connectionState/${inst}`);
    res.json({ connected: data.instance?.state === "open", state: data.instance?.state });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.get("/api/whatsapp/qr", requireAuth, async (req, res) => {
  if (!evo) return res.status(503).json({ error: "Evolution API não configurada" });
  const inst = await getUserInst(req.user.id);
  const ensureInstance = async () => {
    try { await evo.get(`/instance/connectionState/${inst}`); }
    catch {
      await evo.post(`/instance/create`, { instanceName: inst, qrcode: true, integration: "WHATSAPP-BAILEYS" });
      await setupEvolutionWebhook(inst);
    }
  };
  try {
    await ensureInstance();
    const { data } = await evo.get(`/instance/connect/${inst}`);
    if (data.code) {
      res.json({ code: data.code, pairingCode: data.pairingCode });
    } else {
      const stateRes = await evo.get(`/instance/connectionState/${inst}`);
      const state = stateRes.data?.instance?.state;
      if (state === "open") {
        res.json({ connected: true, state });
      } else {
        await evo.delete(`/instance/delete/${inst}`).catch(() => {});
        await evo.post(`/instance/create`, { instanceName: inst, qrcode: true, integration: "WHATSAPP-BAILEYS" });
        await setupEvolutionWebhook(inst);
        const { data: data2 } = await evo.get(`/instance/connect/${inst}`);
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
    const inst = await getUserInst(req.user.id);
    const { data } = await evo.post(`/message/sendText/${inst}`, { number: to, text: message });
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
// ROTAS — E-MAIL (disparo CRM via SMTP próprio do produtor)
// Independente do Resend transacional acima — aqui cada produtor conecta a
// própria conta de e-mail (ex: Gmail + senha de app) para os disparos do CRM.
// ══════════════════════════════════════════════════════════════════════════════

// Traduz o erro técnico do nodemailer pra algo que dá pra agir, em vez do genérico
// "verifique os dados". EAUTH = login/senha errados; timeout/ECONNREFUSED geralmente
// é a porta SMTP bloqueada na rede (comum em alguns hosts de nuvem), não credencial.
function describeSmtpError(err) {
  if (err.code === "EAUTH") return "E-mail ou senha incorretos — se for Gmail/Outlook, use uma senha de app, não a senha normal da conta.";
  if (err.code === "ETIMEDOUT" || err.code === "ESOCKET" || err.responseCode === undefined && /timeout/i.test(err.message || "")) {
    return "O servidor não respondeu a tempo — confira o host/porta, ou pode ser a porta SMTP bloqueada na rede do servidor.";
  }
  if (err.code === "ECONNREFUSED") return "Conexão recusada pelo servidor — confira o host e a porta.";
  if (err.code === "ENOTFOUND") return "Não encontrei esse servidor SMTP — confira se o host está escrito certo.";
  return `Não foi possível conectar (${err.code || err.message || "erro desconhecido"}).`;
}

async function getUserEmailConn(userId) {
  const { data } = await supabase.from("profiles")
    .select("email_smtp_host,email_smtp_port,email_smtp_user,email_smtp_pass,email_from_name,email_connected")
    .eq("id", userId).single();
  return data || null;
}

function buildTransport(conn) {
  return nodemailer.createTransport({
    host: conn.email_smtp_host,
    port: conn.email_smtp_port,
    secure: Number(conn.email_smtp_port) === 465,
    auth: { user: conn.email_smtp_user, pass: conn.email_smtp_pass },
    // Sem isso, se a porta SMTP estiver bloqueada na rede (comum em alguns hosts de
    // nuvem), a conexão fica pendurada por minutos em vez de falhar rápido com um
    // erro que dá pra entender.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

// Verifica a conexão SMTP tentando a porta informada e, se der timeout/conexão
// recusada (sinal de porta bloqueada na rede, não senha errada), tenta
// automaticamente a porta alternativa mais comum (465 SSL ↔ 587 STARTTLS)
// antes de desistir — evita o produtor/Thomas ter que adivinhar qual porta
// funciona na rede do servidor.
async function verifySmtpWithFallback({ host, port, user, pass }) {
  const tried = [];
  const attempt = async (p) => {
    const transporter = buildTransport({ email_smtp_host: host, email_smtp_port: p, email_smtp_user: user, email_smtp_pass: pass });
    await transporter.verify();
    return p;
  };
  try {
    const okPort = await attempt(Number(port));
    return { port: okPort };
  } catch (err) {
    tried.push(err);
    const isNetworkIssue = err.code === "ETIMEDOUT" || err.code === "ESOCKET" || err.code === "ECONNREFUSED";
    const altPort = Number(port) === 465 ? 587 : Number(port) === 587 ? 465 : null;
    if (isNetworkIssue && altPort) {
      try {
        const okPort = await attempt(altPort);
        return { port: okPort };
      } catch (err2) {
        tried.push(err2);
      }
    }
    throw tried[0];
  }
}

app.get("/api/email/status", requireAuth, async (req, res) => {
  const conn = await getUserEmailConn(req.user.id);
  res.json({ connected: !!conn?.email_connected, email: conn?.email_smtp_user || null, fromName: conn?.email_from_name || null });
});

app.post("/api/email/connect", requireAuth, async (req, res) => {
  const { host, port, user, pass, fromName } = req.body || {};
  if (!host || !port || !user || !pass) return res.status(400).json({ error: "Preencha host, porta, e-mail e senha." });
  try {
    const { port: workingPort } = await verifySmtpWithFallback({ host, port, user, pass });
    const { error } = await supabase.from("profiles").update({
      email_smtp_host: host, email_smtp_port: workingPort, email_smtp_user: user,
      email_smtp_pass: pass, email_from_name: fromName || null, email_connected: true,
    }).eq("id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ connected: true, email: user, port: workingPort });
  } catch (err) {
    console.error("[email/connect]", err.message);
    res.status(400).json({ error: describeSmtpError(err) });
  }
});

app.post("/api/email/disconnect", requireAuth, async (req, res) => {
  const { error } = await supabase.from("profiles").update({
    email_smtp_host: null, email_smtp_port: null, email_smtp_user: null,
    email_smtp_pass: null, email_from_name: null, email_connected: false,
  }).eq("id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ connected: false });
});

// ── POST /api/email/send-group ────────────────────────────────────────────────
app.post("/api/email/send-group", requireAuth, requireSubscription, async (req, res) => {
  try {
  const conn = await getUserEmailConn(req.user.id);
  if (!conn?.email_connected) return res.status(503).json({ error: "E-mail não conectado" });
  const { message, subject, group } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "Mensagem vazia" });
  if (!subject?.trim()) return res.status(400).json({ error: "Assunto obrigatório" });
  const transporter = buildTransport(conn);
  const senderName = conn.email_from_name || req.user.user_metadata?.name || "JosephPay";

  let query = supabase.from("customers").select("id,email,name").eq("owner_id", req.user.id);
  if (group && group !== "todos") {
    if (group === "cliente") query = query.or("status.eq.cliente,status.is.null");
    else query = query.eq("status", group);
  }
  const { data: customers, error: custErr } = await query;
  if (custErr) return res.status(500).json({ error: custErr.message });

  const excludedIds = Array.isArray(req.body.excludedIds) ? new Set(req.body.excludedIds) : new Set();
  const skipped = (customers || []).filter(c => !c.email || excludedIds.has(c.id))
    .map(c => ({ name: c.name, reason: !c.email ? 'no_email' : 'excluded' }));
  const withEmail = (customers || []).filter(c => c.email && !excludedIds.has(c.id));
  let sent = 0, failed = 0;
  const log = [...skipped];

  const CHUNK = 5;
  for (let i = 0; i < withEmail.length; i += CHUNK) {
    await Promise.all(withEmail.slice(i, i + CHUNK).map(async c => {
      const personalized = message.replace(/\{nome\}/g, c.name || "");
      try {
        const info = await transporter.sendMail({
          from: `${senderName} <${conn.email_smtp_user}>`,
          to: c.email,
          subject: subject.replace(/\{nome\}/g, c.name || ""),
          text: personalized,
        });
        await supabase.from("messages").insert({
          owner_id: req.user.id, customer_id: c.id, channel: "email",
          direction: "outbound", content: message, type: "text",
          group_target: group || "todos", status: "sent", provider_id: info.messageId || null,
        }).then(null, () => {});
        log.push({ name: c.name, reason: 'sent' });
        sent++;
      } catch (e) {
        console.error(`[email/send-group] falha ${c.name}:`, e.message);
        await supabase.from("messages").insert({
          owner_id: req.user.id, customer_id: c.id, channel: "email",
          direction: "outbound", content: message, type: "text",
          group_target: group || "todos", status: "failed", error_message: e.message,
        }).then(null, () => {});
        log.push({ name: c.name, reason: e.message });
        failed++;
      }
    }));
  }

  await supabase.from("messages").insert({
    owner_id: req.user.id, channel: "email", direction: "outbound", content: message, type: "text",
    group_target: group || "todos", group_count: sent, status: sent > 0 ? "sent" : "failed",
  }).then(null, () => {});

  res.json({ sent, failed, total: withEmail.length, log });
  } catch (e) {
    console.error('[email/send-group] crash:', e.message, e.stack);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
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
      .or(`payment_date.gte.${from},and(payment_date.is.null,created_at.gte.${from})`);

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

app.get("/api/admin/kpis", requireAuth, requireAdmin, async (req, res) => {
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

app.get("/api/admin/sales", requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const owner = req.query.owner;
    let q = supabase.from("sales")
      .select("*,customers(name),products(name),profiles!owner_id(name,avatar_url)")
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

app.get("/api/admin/clients", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from("profiles")
      .select("id,name,role,created_at,email,phone,company_name,site_url,whatsapp_instance,email_connected,minichat_config,last_login_at,avatar_url,gtm_account_id,gtm_container_id,gtm_container_name,gtm_sensor_installed_at,github_repo,github_file_path,github_sensor_installed_at,github_minichat_path,github_minichat_installed_at,github_vercel_ready_at,google_ads_customer_id,disabled_at")
      .order("created_at", { ascending: false });
    if (error) throw error;

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const { data: loginRows } = await supabase.from("login_events")
      .select("user_id").gte("day", monthStart.toISOString().slice(0, 10));
    const loginsPorUsuario = {};
    (loginRows || []).forEach(r => { loginsPorUsuario[r.user_id] = (loginsPorUsuario[r.user_id] || 0) + 1; });

    const { data: ledgerRows } = await supabase.from("platform_ledger")
      .select("related_profile_id,type,amount").not("related_profile_id", "is", null);
    const ledgerPorUsuario = {};
    (ledgerRows || []).forEach(l => {
      const acc = ledgerPorUsuario[l.related_profile_id] || (ledgerPorUsuario[l.related_profile_id] = { mensalidade: 0, ativacao: 0 });
      if (l.type === "mensalidade") acc.mensalidade += Number(l.amount || 0);
      if (l.type === "ativacao")    acc.ativacao    += Number(l.amount || 0);
    });


    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    // Interessados (lead) x Clientes convertidos (cliente/assinante) do CRM de cada produtor.
    const { data: customerRows, error: customerErr } = await supabase.from("customers").select("owner_id,status,created_at");
    if (customerErr) console.error("[admin/clients] customers query error:", customerErr.message, customerErr.details);
    const leadsPorUsuario = {};
    const clientesPorUsuario = {};
    (customerRows || []).forEach(row => {
      const hoje = new Date(row.created_at) >= todayStart;
      const alvo = row.status === "lead" ? leadsPorUsuario : (row.status === "cliente" || row.status === "assinante") ? clientesPorUsuario : null;
      if (!alvo) return;
      const acc = alvo[row.owner_id] || (alvo[row.owner_id] = { total: 0, hoje: 0 });
      acc.total++; if (hoje) acc.hoje++;
    });

    const enriched = await Promise.all((data || []).map(async (p) => {
      const [salesSum, prodCount, wapConnected, visitTotal, visitHoje, hasGclid, hasMiniChat] = await Promise.all([
        supabase.from("sales").select("gross_amount,amount,platform_fee").eq("owner_id", p.id).eq("status", "pago"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("owner_id", p.id),
        // whatsapp_instance só indica que a aba Disparos foi aberta uma vez (o nome da instância
        // é criado automaticamente), não que o WhatsApp foi de fato conectado — por isso checamos
        // o estado real na Evolution API em vez de confiar só na coluna estar preenchida.
        (async () => {
          if (!evo || !p.whatsapp_instance) return false;
          try {
            const { data: st } = await evo.get(`/instance/connectionState/${p.whatsapp_instance}`);
            return st.instance?.state === "open";
          } catch { return false; }
        })(),
        supabase.from("visits").select("*", { count: "exact", head: true }).eq("owner_id", p.id).eq("event_type", "pageview"),
        supabase.from("visits").select("*", { count: "exact", head: true }).eq("owner_id", p.id).eq("event_type", "pageview").gte("created_at", todayStart.toISOString()),
        supabase.from("visits").select("*", { count: "exact", head: true }).eq("owner_id", p.id).eq("event_type", "pageview").eq("has_gclid", true).then(r => r.count > 0, () => false),
        supabase.from("visits").select("*", { count: "exact", head: true }).eq("owner_id", p.id).ilike("page", "%minichat%").then(r => (r.count || 0) > 0, () => false),
      ]);
      const vol  = (salesSum.data || []).reduce((a, s) => a + Number(s.gross_amount || s.amount || 0), 0);
      const taxa = (salesSum.data || []).reduce((a, s) => a + Number(s.platform_fee || Math.round(Number(s.gross_amount || s.amount || 0) * PLATFORM_FEE_RATE * 100) / 100), 0);
      const vtotal = visitTotal.count || 0;
      return {
        ...p,
        vol: Math.round(vol * 100) / 100,
        taxa: Math.round(taxa * 100) / 100,
        produtos: prodCount.count || 0,
        last_login_at: p.last_login_at || null,
        logins_mes: loginsPorUsuario[p.id] || 0,
        mensalidade_total: Math.round((ledgerPorUsuario[p.id]?.mensalidade || 0) * 100) / 100,
        ativacao_total: Math.round((ledgerPorUsuario[p.id]?.ativacao || 0) * 100) / 100,
        leads_total: leadsPorUsuario[p.id]?.total || 0,
        leads_hoje: leadsPorUsuario[p.id]?.hoje || 0,
        clientes_total: clientesPorUsuario[p.id]?.total || 0,
        clientes_hoje: clientesPorUsuario[p.id]?.hoje || 0,
        visitas_total: vtotal,
        visitas_hoje: visitHoje.count || 0,
        conn: {
          whatsapp: wapConnected,
          site:     !!p.github_sensor_installed_at || !!p.gtm_sensor_installed_at || vtotal > 0,
          email:    !!p.email_connected,
          minichat: hasMiniChat,
          googleAds: !!hasGclid,
        },
      };
    }));
    res.json({ clients: enriched });
  } catch (err) {
    console.error("[admin/clients]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/chart", requireAuth, requireAdmin, async (req, res) => {
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

// Saldo geral do Admin: soma taxas de todas as vendas de todos os produtores
// (sales.platform_fee) + mensalidades e ativações registradas no ledger,
// menos o que o admin já sacou. Não mexe no saque em si (/api/asaas/withdraw
// continua igual) — só mostra o total disponível pra saque.
// Admin: lista os produtos de um produtor específico (?owner=<id>), com stats do mês.
app.get("/api/admin/products", requireAuth, requireAdmin, async (req, res) => {
  try {
    const owner = req.query.owner;
    if (!owner) return res.status(400).json({ error: "owner é obrigatório" });
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { data: products, error } = await supabase
      .from("products").select("*").eq("owner_id", owner).order("created_at", { ascending: false });
    if (error) throw error;

    const enriched = await Promise.all((products || []).map(async (p) => {
      const [salesMonth, totalSales] = await Promise.all([
        supabase.from("sales").select("producer_amount,amount").eq("product_id", p.id).eq("status", "pago").gte("created_at", monthStart),
        supabase.from("sales").select("id", { count: "exact", head: true }).eq("product_id", p.id).eq("status", "pago"),
      ]);
      const receitaMes = (salesMonth.data || []).reduce((a, s) => a + Number(s.producer_amount || s.amount || 0), 0);
      return { ...p, receitaMes, totalVendas: totalSales.count || 0 };
    }));
    res.json({ products: enriched });
  } catch (err) {
    console.error("[admin/products]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Admin: cria um produto em nome de um produtor específico (owner_id no corpo).
app.post("/api/admin/products", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { owner_id } = req.body;
    if (!owner_id) return res.status(400).json({ error: "owner_id é obrigatório" });
    const r = await createProductForOwner(owner_id, req.body);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ product: r.product, paymentUrl: r.paymentUrl, asaasLinkId: r.mpPrefId });
  } catch (err) {
    console.error("[admin/products create]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/ledger/balance", requireAuth, requireAdmin, async (req, res) => {
  try {
    const uid = req.user.id;
    const [{ data: sales }, { data: ledger }, { data: withdrawals }] = await Promise.all([
      supabase.from("sales").select("platform_fee,gross_amount,amount").in("status", ["recebido", "pago"]),
      supabase.from("platform_ledger").select("amount,type"),
      supabase.from("withdrawals").select("amount,status").eq("owner_id", uid).in("status", ["processando", "concluido"]),
    ]);
    const totalTaxas = (sales || []).reduce((a, s) => a + Number(s.platform_fee ?? Math.round(Number(s.gross_amount || s.amount || 0) * PLATFORM_FEE_RATE * 100) / 100), 0);
    const totalLedger = (ledger || []).reduce((a, l) => a + Number(l.amount || 0), 0);
    const totalMensalidade = (ledger || []).filter(l => l.type === "mensalidade").reduce((a, l) => a + Number(l.amount || 0), 0);
    const totalAtivacao = (ledger || []).filter(l => l.type === "ativacao").reduce((a, l) => a + Number(l.amount || 0), 0);
    const totalWithdrawn = (withdrawals || []).reduce((a, w) => a + Number(w.amount), 0);
    const balance = Math.max(0, totalTaxas + totalLedger - totalWithdrawn);
    res.json({
      balance:           Math.round(balance * 100) / 100,
      totalTaxas:        Math.round(totalTaxas * 100) / 100,
      totalLedger:       Math.round(totalLedger * 100) / 100,
      totalMensalidade:  Math.round(totalMensalidade * 100) / 100,
      totalAtivacao:     Math.round(totalAtivacao * 100) / 100,
      totalWithdrawn:    Math.round(totalWithdrawn * 100) / 100,
    });
  } catch (err) {
    console.error("[admin/ledger/balance]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/subscriptions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from("subscriptions")
      .select("*,customers(name),products(name),profiles!owner_id(name,avatar_url)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ subscriptions: data || [] });
  } catch (err) {
    console.error("[admin/subscriptions]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: cadastrar produtor/afiliado (cria a conta e define a senha) ──────
function generatePassword() {
  return require("crypto").randomBytes(9).toString("base64").replace(/[+/=]/g, "x");
}

app.post("/api/admin/producers", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { tipo, name, email, password, phone, product_id, commission_rate, ativacao_valor } = req.body;
    if (!["client", "afiliado"].includes(tipo)) return res.status(400).json({ error: "Tipo inválido" });
    if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: "Nome e e-mail são obrigatórios" });
    const finalPassword = password?.trim() || generatePassword();
    if (finalPassword.length < 6) return res.status(400).json({ error: "Senha deve ter ao menos 6 caracteres" });

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password: finalPassword,
      email_confirm: true,
      user_metadata: { name: name.trim(), role: tipo },
    });
    if (createErr) return res.status(400).json({ error: createErr.message });
    const newId = created.user.id;

    await supabase.from("profiles").upsert(
      { id: newId, name: name.trim(), role: tipo, email: email.trim(), phone: phone?.trim() || null },
      { onConflict: "id" }
    );

    if (tipo === "afiliado" && product_id) {
      await supabase.from("affiliates").insert({
        product_id, user_id: newId,
        commission_rate: Number(commission_rate) || 0,
        status: "ativo",
      });
    }

    const ativacaoNum = Number(ativacao_valor) || 0;
    if (ativacaoNum > 0) {
      await supabase.from("platform_ledger").insert({
        type: "ativacao", amount: ativacaoNum, related_profile_id: newId,
        description: `Ativação de ${name.trim()}`,
      });
    }

    const sensorSnippet = `<script src="https://josephpay-production.up.railway.app/sensor.js?uid=${newId}"><\/script>`;
    res.json({ id: newId, email: email.trim(), password: finalPassword, sensorSnippet });
  } catch (err) {
    console.error("[admin/producers create]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/producers/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const newPassword = generatePassword();
    const { error } = await supabase.auth.admin.updateUserById(id, { password: newPassword });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ id, password: newPassword });
  } catch (err) {
    console.error("[admin/producers reset-password]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Admin edita nome/empresa/e-mail de qualquer cliente em nome dele.
// Trocar o e-mail atualiza também o login (Auth), pra não ficar um mostrando
// um e-mail e o login continuar sendo outro.
app.patch("/api/admin/producers/:id/profile", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, company_name, email, site_url } = req.body;
    const updates = {};
    if (name         !== undefined) updates.name         = name?.trim()         || null;
    if (company_name !== undefined) updates.company_name = company_name?.trim() || null;
    if (site_url     !== undefined) updates.site_url     = site_url?.trim()     || null;
    if (email?.trim()) {
      const newEmail = email.trim();
      const { data: current } = await supabase.from("profiles").select("email").eq("id", id).maybeSingle();
      if (current?.email !== newEmail) {
        const { error: authErr } = await supabase.auth.admin.updateUserById(id, { email: newEmail, email_confirm: true });
        if (authErr) return res.status(400).json({ error: authErr.message });
      }
      updates.email = newEmail;
    }
    if (!Object.keys(updates).length) return res.json({ ok: true });
    const { error } = await supabase.from("profiles").update(updates).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, ...updates });
  } catch (err) {
    console.error("[admin/producers profile]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Ativa ou desativa um produtor (soft-delete: só seta/limpa disabled_at).
// Requer migration_v34.sql aplicada no Supabase.
app.post("/api/admin/producers/:id/toggle-active", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: current } = await supabase.from("profiles").select("disabled_at").eq("id", id).maybeSingle();
    const nowDisabled = !!current?.disabled_at;
    const update = nowDisabled
      ? { disabled_at: null }
      : { disabled_at: new Date().toISOString() };
    const { error } = await supabase.from("profiles").update(update).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, active: nowDisabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/producers/:id/disparos", requireAuth, requireAdmin, async (req, res) => {
  const { data } = await supabase.from("profiles").select("disparos").eq("id", req.params.id).single();
  res.json(data?.disparos || []);
});

app.patch("/api/admin/producers/:id/disparos", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!Array.isArray(req.body)) return res.status(400).json({ error: "Array esperado" });
  const { error } = await supabase.from("profiles").update({ disparos: req.body }).eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.patch("/api/admin/producers/:pid/customers/:cid", requireAuth, requireAdmin, async (req, res) => {
  const { pid, cid } = req.params;
  const { name, phone, email, birthday, status } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = String(name).trim();
  if (phone !== undefined) updates.phone = String(phone || "").trim() || null;
  if (email !== undefined) updates.email = String(email || "").trim() || null;
  if (birthday !== undefined) updates.birthday = birthday || null;
  if (status !== undefined) updates.status = status;
  if (!Object.keys(updates).length) return res.status(400).json({ error: "Nada para atualizar" });
  const { error } = await supabase.from("customers").update(updates).eq("id", cid).eq("owner_id", pid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.delete("/api/admin/producers/:pid/customers/:cid", requireAuth, requireAdmin, async (req, res) => {
  const { pid, cid } = req.params;
  const { error } = await supabase.from("customers")
    .update({ deleted_at: new Date().toISOString() }).eq("id", cid).eq("owner_id", pid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.patch("/api/admin/products/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, price } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = String(name).trim();
  if (price !== undefined) updates.price = Number(price);
  if (!Object.keys(updates).length) return res.status(400).json({ error: "Nada para atualizar" });
  const { error } = await supabase.from("products").update(updates).eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Nota privada do admin sobre esse produtor — fica numa tabela própria
// (producer_notes), nunca em profiles, pra não vazar pro próprio produtor.
app.get("/api/admin/producers/:id/notes", requireAuth, requireAdmin, async (req, res) => {
  const { data } = await supabase.from("producer_notes").select("note,updated_at").eq("producer_id", req.params.id).maybeSingle();
  res.json({ note: data?.note || "", updated_at: data?.updated_at || null });
});

app.patch("/api/admin/producers/:id/notes", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const { error } = await supabase.from("producer_notes").upsert({ producer_id: id, note: note || null, updated_at: new Date().toISOString() });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin/producers notes]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Admin adiciona contatos em massa direto no CRM de um cliente (tabela customers) —
// os contatos aparecem no painel do próprio produtor, é a mesma tabela que ele usa.
app.post("/api/admin/producers/:id/customers/bulk", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || !contacts.length) return res.status(400).json({ error: "Nenhum contato enviado" });
    const rows = contacts
      .map(c => ({
        owner_id: id,
        name: String(c?.name || "").trim(),
        phone: c?.phone ? String(c.phone).trim() : null,
        email: c?.email ? String(c.email).trim() : null,
        status: c?.status === "cliente" ? "cliente" : "lead",
        source: "manual",
      }))
      .filter(c => c.name);
    if (!rows.length) return res.status(400).json({ error: "Nenhum contato válido (precisa de nome)" });
    const { data, error } = await supabase.from("customers").insert(rows).select("id");
    if (error) return res.status(500).json({ error: error.message });
    if (rows.length === 1) {
      sendPushToOwner(id, { title: "Novo interessado!", body: rows[0].name, url: "/" });
    } else {
      sendPushToOwner(id, { title: "Novos interessados!", body: `${rows.length} contatos adicionados`, url: "/" });
    }
    res.json({ ok: true, count: data.length });
  } catch (err) {
    console.error("[admin/producers customers bulk]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Admin visualiza os clientes/interessados de um produtor específico — mesma tabela
// que o produtor já usa no próprio CRM, só que lido pelo backend (service role) em
// vez do Supabase anônimo do produtor, já que o Admin não tem a sessão dele.
// Só leitura — nenhum envio de mensagem acontece por aqui.
app.get("/api/admin/producers/:id/customers", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,phone,email,status,source,birthday,created_at")
      .eq("owner_id", req.params.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ customers: data || [] });
  } catch (err) {
    console.error("[admin/producers customers]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Visão geral do Mini Chat de todos os produtores — quantas sessões, quantas
// terminaram, taxa de conclusão. Agrega em memória (volume baixo o suficiente
// pra não precisar de RPC/SQL agregado por enquanto).
app.get("/api/admin/minichat/overview", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [{ data: sessions, error }, { data: profiles }] = await Promise.all([
      supabase.from("minichat_sessions").select("owner_id,completed_at,updated_at"),
      supabase.from("profiles").select("id,name,company_name,avatar_url").eq("role", "client"),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    const porDono = {};
    (sessions || []).forEach(s => {
      if (!porDono[s.owner_id]) porDono[s.owner_id] = { total: 0, completas: 0, ultima: null };
      const d = porDono[s.owner_id];
      d.total++;
      if (s.completed_at) d.completas++;
      if (!d.ultima || s.updated_at > d.ultima) d.ultima = s.updated_at;
    });
    const rows = Object.keys(porDono).map(ownerId => {
      const p = (profiles || []).find(x => x.id === ownerId);
      const d = porDono[ownerId];
      return {
        id: ownerId,
        name: p?.name || null,
        company_name: p?.company_name || null,
        avatar_url: p?.avatar_url || null,
        total: d.total,
        completas: d.completas,
        taxa: d.total ? Math.round((d.completas / d.total) * 100) : 0,
        ultima_sessao: d.ultima,
      };
    }).sort((a, b) => b.total - a.total);
    res.json({ produtores: rows });
  } catch (err) {
    console.error("[admin/minichat/overview]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Detalhe do Mini Chat de um produtor: funil (quantas sessões chegaram em cada
// pergunta) + lista de sessões individuais com as respostas dadas.
app.get("/api/admin/producers/:id/minichat/sessions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from("minichat_sessions")
      .select("id,visitor_id,questions_total,current_index,answers,completed_at,finished_via,created_at,updated_at")
      .eq("owner_id", req.params.id)
      .order("updated_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const rows = sessions || [];
    const maxPerguntas = Math.max(0, ...rows.map(s => s.questions_total || 0));
    // funil[i] = quantas sessões chegaram a responder (ou passar por) a pergunta i
    const funil = Array.from({ length: maxPerguntas }, (_, i) => rows.filter(s => s.current_index >= i || s.completed_at).length);
    res.json({ sessoes: rows, funil, total: rows.length, completas: rows.filter(s => s.completed_at).length });
  } catch (err) {
    console.error("[admin/producers minichat sessions]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Admin conecta/desconecta o e-mail (SMTP) de qualquer cliente em nome dele —
// mesma lógica de /api/email/connect, só que escopada pelo :id em vez do usuário logado.
app.get("/api/admin/producers/:id/email/status", requireAuth, requireAdmin, async (req, res) => {
  const conn = await getUserEmailConn(req.params.id);
  res.json({ connected: !!conn?.email_connected, email: conn?.email_smtp_user || null, fromName: conn?.email_from_name || null });
});

app.post("/api/admin/producers/:id/email/connect", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { host, port, user, pass, fromName } = req.body || {};
  if (!host || !port || !user || !pass) return res.status(400).json({ error: "Preencha host, porta, e-mail e senha." });
  try {
    const { port: workingPort } = await verifySmtpWithFallback({ host, port, user, pass });
    const { error } = await supabase.from("profiles").update({
      email_smtp_host: host, email_smtp_port: workingPort, email_smtp_user: user,
      email_smtp_pass: pass, email_from_name: fromName || null, email_connected: true,
    }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ connected: true, email: user, port: workingPort });
  } catch (err) {
    console.error("[admin/producers email/connect]", err.message);
    res.status(400).json({ error: describeSmtpError(err) });
  }
});

app.post("/api/admin/producers/:id/email/disconnect", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase.from("profiles").update({
    email_smtp_host: null, email_smtp_port: null, email_smtp_user: null,
    email_smtp_pass: null, email_from_name: null, email_connected: false,
  }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ connected: false });
});

// Upload da foto de perfil do Mini Chat de um cliente — mesmo padrão do upload de avatar
// do usuário (/api/user/avatar), só que o admin escolhe o cliente via :id.
app.post("/api/admin/producers/:id/minichat/avatar", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { base64 } = req.body;
  if (!base64) return res.status(400).json({ error: "base64 ausente" });
  const match = base64.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "formato inválido" });
  const contentType = match[1];
  const ext = contentType.split("/")[1] || "jpg";
  const buffer = Buffer.from(match[2], "base64");
  const path = `minichat/${id}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, buffer, { contentType, upsert: true });
  if (error) return res.status(500).json({ error: error.message });
  const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
  res.json({ url: `${publicUrl}?v=${Date.now()}` });
});

// Upload da foto de perfil da CONTA do cliente (a que aparece no card da lista de
// Clientes e no topo do perfil no Admin) — diferente da foto do Mini Chat acima.
// Mesmo padrão de /api/user/avatar, mas o admin escolhe o cliente via :id e o
// upload já salva direto em profiles.avatar_url (não precisa de um "Salvar" separado).
app.post("/api/admin/producers/:id/avatar", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { base64 } = req.body;
  if (!base64) return res.status(400).json({ error: "base64 ausente" });
  const match = base64.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "formato inválido" });
  const contentType = match[1];
  const ext = contentType.split("/")[1] || "jpg";
  const buffer = Buffer.from(match[2], "base64");
  const path = `avatars/${id}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, buffer, { contentType, upsert: true });
  if (error) return res.status(500).json({ error: error.message });
  const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
  const url = `${publicUrl}?v=${Date.now()}`;
  await supabase.from("profiles").update({ avatar_url: url }).eq("id", id);
  res.json({ url });
});

// Gera (com IA) uma pergunta do Mini Chat com base nos dados reais deste cliente
// (nome/marca, site, produtos cadastrados) — não salva nada, só devolve a sugestão
// pro admin revisar/editar antes de clicar em "Salvar perguntas".
app.post("/api/admin/producers/:id/minichat/generate-question", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { index, questions } = req.body;
    if (!Array.isArray(questions) || typeof index !== "number" || !questions[index]) {
      return res.status(400).json({ error: "Dados inválidos" });
    }
    const [{ data: profile }, { data: products }] = await Promise.all([
      supabase.from("profiles").select("name,company_name,site_url,minichat_config").eq("id", id).maybeSingle(),
      supabase.from("products").select("name").eq("owner_id", id).order("created_at", { ascending: false }).limit(10),
    ]);
    const negocio = `Nome/marca: ${profile?.company_name || profile?.name || "—"}
Site: ${profile?.site_url || "—"}
Produtos/serviços cadastrados: ${(products || []).map(p => p.name).filter(Boolean).join(", ") || "nenhum cadastrado ainda"}
Sobre o negócio (ramo, público, diferenciais): ${profile?.minichat_config?.business_context || "não informado — pergunte de forma genérica"}`;
    const outrasPerguntas = questions.map((q, i) => i === index ? null : `${i + 1}. ${q.subtext || q.text}`).filter(Boolean).join("\n") || "nenhuma";

    const systemPrompt = `Você escreve perguntas para um Mini Chat de diagnóstico (estilo WhatsApp, botões de resposta rápida) usado por negócios pra qualificar leads antes de mandar pro WhatsApp.
Dados reais do negócio deste cliente:
${negocio}
Outras perguntas já existentes no fluxo (não repita o mesmo assunto):
${outrasPerguntas}
Gere APENAS a pergunta de número ${index + 1}, adaptada ao negócio acima. Responda em JSON puro, sem markdown, sem texto fora do JSON, no formato exato:
{"text":"frase curta de transição (ex: Perfeito.)","subtext":"a pergunta em si, objetiva","options":["opção 1","opção 2","opção 3","opção 4"]}
As opções devem ser curtas (até 4 palavras), plausíveis pra esse negócio específico, e sempre 3 a 5 opções. Português do Brasil.`;

    let reply = null, lastErr = null;
    for (const key of GROQ_KEYS) {
      try { reply = await callGroq(key, systemPrompt, [{ role: "user", content: "Gere a pergunta." }]); break; }
      catch (e) { lastErr = e; console.warn("[minichat generate-question] groq falhou, tentando próxima:", e.response?.data?.error?.message || e.message); }
    }
    if (reply === null && process.env.ANTHROPIC_API_KEY) {
      try { reply = await callAnthropic(systemPrompt, [{ role: "user", content: "Gere a pergunta." }]); }
      catch (e) { lastErr = e; console.error("[minichat generate-question] anthropic falhou:", e.response?.data || e.message); }
    }
    if (reply === null) throw lastErr || new Error("Nenhum provedor de IA configurado");

    const match = reply.match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = match ? JSON.parse(match[0]) : null; } catch { parsed = null; }
    if (!parsed || !parsed.subtext || !Array.isArray(parsed.options)) {
      return res.status(500).json({ error: "A IA não retornou um formato válido, tenta de novo." });
    }
    res.json({
      question: {
        text: String(parsed.text || "").trim(),
        subtext: String(parsed.subtext || "").trim(),
        options: parsed.options.map(o => String(o || "").trim()).filter(Boolean).slice(0, 6),
      },
    });
  } catch (err) {
    console.error("[admin/producers minichat generate-question]", err.message);
    res.status(500).json({ error: "Não consegui gerar a pergunta agora. Tenta de novo em instantes." });
  }
});

// Mesma ideia do endpoint acima, mas gera o fluxo inteiro (N perguntas) de uma
// vez só, numa única chamada de IA — pra não precisar clicar pergunta por pergunta.
app.post("/api/admin/producers/:id/minichat/generate-all-questions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let { count, business_context } = req.body;
    count = Math.min(Math.max(Number(count) || 4, 2), 8);
    const [{ data: profile }, { data: products }] = await Promise.all([
      supabase.from("profiles").select("name,company_name,site_url,minichat_config").eq("id", id).maybeSingle(),
      supabase.from("products").select("name").eq("owner_id", id).order("created_at", { ascending: false }).limit(10),
    ]);
    // Se veio um contexto novo nessa chamada (campo preenchido na hora, ainda não
    // salvo), usa ele e já aproveita pra persistir — economiza um clique de "Salvar".
    const contextoFinal = business_context?.trim() || profile?.minichat_config?.business_context || "";
    if (business_context !== undefined && contextoFinal !== (profile?.minichat_config?.business_context || "")) {
      await supabase.from("profiles").update({
        minichat_config: { ...(profile?.minichat_config || {}), business_context: contextoFinal || null },
      }).eq("id", id);
    }
    const negocio = `Nome/marca: ${profile?.company_name || profile?.name || "—"}
Site: ${profile?.site_url || "—"}
Produtos/serviços cadastrados: ${(products || []).map(p => p.name).filter(Boolean).join(", ") || "nenhum cadastrado ainda"}
Sobre o negócio (ramo, público, diferenciais): ${contextoFinal || "não informado — pergunte de forma genérica"}`;

    const systemPrompt = `Você escreve o fluxo completo de perguntas de um Mini Chat de diagnóstico (estilo WhatsApp, botões de resposta rápida) usado por negócios pra qualificar leads antes de mandar pro WhatsApp.
Dados reais do negócio deste cliente:
${negocio}
Gere exatamente ${count} perguntas, cada uma sobre um assunto diferente (não repita o mesmo tema), formando uma sequência lógica de diagnóstico que termina qualificando o lead pra falar no WhatsApp. Responda em JSON puro, sem markdown, sem texto fora do JSON, no formato exato:
{"questions":[{"text":"frase curta de transição (ex: Perfeito.)","subtext":"a pergunta em si, objetiva","options":["opção 1","opção 2","opção 3","opção 4"]}]}
As opções devem ser curtas (até 4 palavras), plausíveis pra esse negócio específico, e sempre 3 a 5 opções por pergunta. Português do Brasil.`;

    let reply = null, lastErr = null;
    for (const key of GROQ_KEYS) {
      try { reply = await callGroq(key, systemPrompt, [{ role: "user", content: "Gere as perguntas." }]); break; }
      catch (e) { lastErr = e; console.warn("[minichat generate-all-questions] groq falhou, tentando próxima:", e.response?.data?.error?.message || e.message); }
    }
    if (reply === null && process.env.ANTHROPIC_API_KEY) {
      try { reply = await callAnthropic(systemPrompt, [{ role: "user", content: "Gere as perguntas." }]); }
      catch (e) { lastErr = e; console.error("[minichat generate-all-questions] anthropic falhou:", e.response?.data || e.message); }
    }
    if (reply === null) throw lastErr || new Error("Nenhum provedor de IA configurado");

    const match = reply.match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = match ? JSON.parse(match[0]) : null; } catch { parsed = null; }
    if (!parsed || !Array.isArray(parsed.questions) || !parsed.questions.length) {
      return res.status(500).json({ error: "A IA não retornou um formato válido, tenta de novo." });
    }
    const questions = parsed.questions
      .map(q => ({
        text: String(q?.text || "").trim(),
        subtext: String(q?.subtext || "").trim(),
        options: Array.isArray(q?.options) ? q.options.map(o => String(o || "").trim()).filter(Boolean).slice(0, 6) : [],
      }))
      .filter(q => q.subtext && q.options.length >= 2);
    if (!questions.length) return res.status(500).json({ error: "A IA não retornou perguntas válidas, tenta de novo." });
    res.json({ questions });
  } catch (err) {
    console.error("[admin/producers minichat generate-all-questions]", err.message);
    res.status(500).json({ error: "Não consegui gerar as perguntas agora. Tenta de novo em instantes." });
  }
});

// Após salvar o minichat, corrige silenciosamente qualquer link josephpay.com/minichat
// nos arquivos do repositório do produtor que estejam sem o ?uid= correto.
// Fire-and-forget: não bloqueia a resposta, erros só aparecem no log.
async function autoFixMinichatLink(id) {
  try {
    const { data: profile } = await supabase.from("profiles")
      .select("github_repo,github_file_path,github_minichat_path")
      .eq("id", id).maybeSingle();
    if (!profile?.github_repo) return;
    const token = await getGithubToken();
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    const repo = profile.github_repo;
    const correctLink = `https://josephpay.com/minichat.html?uid=${id}`;
    // Regex: qualquer link josephpay.com/minichat (com ou sem .html, com ou sem ?uid=qualquer-coisa)
    const re = /https:\/\/josephpay\.com\/minichat(?:\.html)?(?:\?[^"'`\s<>]*)*/g;
    const files = [...new Set([profile.github_file_path, profile.github_minichat_path].filter(Boolean))];
    for (const filePath of files) {
      try {
        const resp = await axios.get(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, { headers });
        const sha = resp.data.sha;
        const original = Buffer.from(resp.data.content, "base64").toString("utf8");
        const updated = original.replace(re, correctLink);
        if (updated === original) continue;
        await axios.put(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, {
          message: "JosephPay: corrige link do Mini Chat com uid do produtor",
          content: Buffer.from(updated, "utf8").toString("base64"),
          sha,
        }, { headers });
        console.log(`[minichat/auto-link] ${repo}/${filePath} atualizado com uid=${id}`);
      } catch(e) {
        console.warn(`[minichat/auto-link] ${repo}/${filePath}:`, e.response?.data?.message || e.message);
      }
    }
  } catch(e) {
    console.warn("[minichat/auto-link]", e.message);
  }
}

app.patch("/api/admin/producers/:id/minichat", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { whatsapp_number, brand_name, greeting_name, avatar_url, redirect_link, email_destino, destination_type, questions, objetivo_options, business_context, closing_message } = req.body;
    // Atualização parcial: só mexe nos campos que vieram no corpo, mantendo o resto do que já
    // estava salvo — assim a tela de "Ativação" e a tela de "Perguntas" podem salvar separadas,
    // sem uma apagar o que a outra já tinha configurado.
    const { data: current } = await supabase.from("profiles").select("minichat_config").eq("id", id).maybeSingle();
    const existing = current?.minichat_config || {};
    let cleanQuestions = existing.questions ?? null;
    if (questions !== undefined) {
      // Perguntas personalizadas são opcionais — só aceita perguntas com texto e pelo menos 2 opções válidas.
      // Se vier vazio/inválido, o widget usa as 4 perguntas padrão (não quebra o cliente).
      cleanQuestions = Array.isArray(questions)
        ? questions
            .map(q => ({
              text: String(q?.text || "").trim(),
              subtext: String(q?.subtext || "").trim(),
              options: Array.isArray(q?.options) ? q.options.map(o => String(o || "").trim()).filter(Boolean) : [],
            }))
            .filter(q => q.text && q.options.length >= 2)
        : [];
      if (!cleanQuestions.length) cleanQuestions = null;
    }
    const minichat_config = {
      whatsapp_number: whatsapp_number !== undefined ? whatsapp_number.trim() : existing.whatsapp_number,
      brand_name: brand_name !== undefined ? (brand_name?.trim() || null) : (existing.brand_name ?? null),
      greeting_name: greeting_name !== undefined ? (greeting_name?.trim() || brand_name?.trim() || null) : (existing.greeting_name ?? null),
      avatar_url: avatar_url !== undefined ? (avatar_url?.trim() || null) : (existing.avatar_url ?? null),
      redirect_link: redirect_link !== undefined ? (redirect_link?.trim() || null) : (existing.redirect_link ?? null),
      email_destino: email_destino !== undefined ? (email_destino?.trim() || null) : (existing.email_destino ?? null),
      // Opções da pergunta "objetivo" no fluxo padrão do Mini Chat — se não configurar,
      // essa pergunta vira campo de texto livre em vez de múltipla escolha.
      objetivo_options: objetivo_options !== undefined
        ? (Array.isArray(objetivo_options) ? objetivo_options.map(o => String(o || "").trim()).filter(Boolean) : []).slice(0, 6)
        : (existing.objetivo_options ?? null),
      questions: cleanQuestions,
      // Texto livre sobre o negócio (ramo, público, diferenciais) — usado só pra dar
      // contexto real pra IA quando o admin pede pra gerar/sugerir perguntas.
      business_context: business_context !== undefined ? (business_context?.trim() || null) : (existing.business_context ?? null),
      closing_message: closing_message !== undefined ? (closing_message?.trim() || null) : (existing.closing_message ?? null),
      destination_type: destination_type !== undefined ? (destination_type || "whatsapp") : (existing.destination_type ?? "whatsapp"),
    };
    if (minichat_config.objetivo_options && !minichat_config.objetivo_options.length) minichat_config.objetivo_options = null;
    if (!minichat_config.whatsapp_number && !minichat_config.email_destino) return res.status(400).json({ error: "Configure o destino dos leads: número de WhatsApp ou e-mail de destino." });
    const { error } = await supabase.from("profiles").update({ minichat_config }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    // Corrige o link do minichat no repositório do produtor de forma assíncrona (não bloqueia)
    autoFixMinichatLink(id).catch(() => {});
    res.json({ ok: true, minichat_config });
  } catch (err) {
    console.error("[admin/producers minichat]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Reinstala o arquivo redirect do Mini Chat no repositório do cliente usando
// o caminho já salvo em github_minichat_path — útil para corrigir uid errado
// sem precisar selecionar o caminho novamente.
app.post("/api/admin/producers/:id/github/reinstall-minichat", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: profile } = await supabase.from("profiles")
      .select("github_repo,github_minichat_path")
      .eq("id", id).maybeSingle();
    if (!profile?.github_repo) return res.status(400).json({ error: "Repositório não vinculado" });
    const filePath = profile.github_minichat_path || "minichat.html";
    const token = await getGithubToken();
    if (!token) return res.status(400).json({ error: "GitHub não conectado" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    const repo = profile.github_repo;
    const minichatLink = `https://josephpay.com/minichat.html?uid=${id}`;
    const loaderHtml = `<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<meta http-equiv="refresh" content="0;url=${minichatLink}">\n<title>Mini Chat</title>\n<script>window.location.replace(${JSON.stringify(minichatLink)});<\/script>\n</head>\n<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font-family:sans-serif">\n<p>Redirecionando…</p>\n</body>\n</html>\n`;
    let sha;
    try {
      const existing = await axios.get(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, { headers });
      sha = existing.data.sha;
    } catch (e) {
      if (e.response?.status !== 404) throw e;
    }
    await axios.put(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, {
      message: "JosephPay: corrige UID do Mini Chat",
      content: Buffer.from(loaderHtml, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
    }, { headers });
    await supabase.from("profiles").update({ github_minichat_installed_at: new Date().toISOString() }).eq("id", id);
    res.json({ ok: true, file_path: filePath });
  } catch (err) {
    console.error("[reinstall-minichat]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// ── Mini Chat: config pública por produtor (lida pelo widget embutido) ──────
app.options("/api/minichat/config", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});
app.get("/api/minichat/config", async (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: "uid ausente" });
  const { data } = await supabase.from("profiles").select("minichat_config, name").eq("id", uid).single();
  const cfg = data?.minichat_config || {};
  // Use producer name from profiles as fallback when brand_name not explicitly set
  if (!cfg.brand_name && data?.name) cfg.brand_name = data.name;
  res.json({ config: Object.keys(cfg).length ? cfg : null, producer_name: data?.name || null });
});

// Lista pública (só nome) dos produtos de um produtor — usada pelo Mini Chat como opções
// reais da pergunta "qual procedimento/produto desperta seu interesse".
app.options("/api/minichat/products", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});
app.get("/api/minichat/products", async (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: "uid ausente" });
  const { data } = await supabase.from("products").select("name").eq("owner_id", uid).order("created_at", { ascending: false });
  res.json({ products: (data || []).map(p => p.name).filter(Boolean) });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — Integração Google Tag Manager (admin-only, uma conta Google só,
// dona de todos os containers). O produtor nunca vê nem participa desse fluxo —
// só o admin conecta a própria conta uma vez e instala o sensor remotamente.
// ══════════════════════════════════════════════════════════════════════════════

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = `${PUBLIC_URL}/api/admin/google/callback`;
const GTM_SCOPE = "https://www.googleapis.com/auth/tagmanager.edit.containers https://www.googleapis.com/auth/tagmanager.publish https://www.googleapis.com/auth/tagmanager.readonly";
// Mesma conexão Google do admin também pede o escopo do Ads — assim uma única
// conta conectada cobre GTM e Google Ads, sem exigir uma segunda tela de login.
// Quem conectou antes dessa mudança precisa clicar em "Conectar" de novo uma vez
// pra conceder essa permissão extra (o Google sempre reabre a tela de consentimento).
const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
// userinfo.email é só pra mostrar qual conta está conectada na tela — a conexão em si
// não depende dela (ver checagem de "conectado" abaixo, que usa refresh_token).
const GOOGLE_SCOPE = `${GTM_SCOPE} ${GOOGLE_ADS_SCOPE} https://www.googleapis.com/auth/userinfo.email`;
const GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";

// state do OAuth só precisa viver alguns minutos (tempo de o admin logar no Google) —
// mapa em memória é suficiente, não precisa de tabela pra isso.
const googleOAuthStates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [state, ts] of googleOAuthStates) if (now - ts > 10 * 60 * 1000) googleOAuthStates.delete(state);
}, 5 * 60 * 1000);

async function getGoogleAccessToken() {
  const { data: row } = await supabase.from("platform_google_auth").select("*").eq("id", 1).maybeSingle();
  if (!row?.refresh_token) return null;
  if (row.access_token && row.expires_at && new Date(row.expires_at) > new Date(Date.now() + 60000)) {
    return row.access_token;
  }
  const resp = await axios.post("https://oauth2.googleapis.com/token", new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: row.refresh_token,
    grant_type: "refresh_token",
  }));
  const { access_token, expires_in } = resp.data;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
  await supabase.from("platform_google_auth").update({ access_token, expires_at, updated_at: new Date().toISOString() }).eq("id", 1);
  return access_token;
}

app.get("/api/admin/google/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from("platform_google_auth").select("refresh_token,connected_email,updated_at").eq("id", 1).maybeSingle();
    // "Conectado" depende do refresh_token existir, não do e-mail — o e-mail é só exibição
    // e pode não vir se o Google não devolver esse dado (ex: escopo antigo sem userinfo.email).
    res.json({ connected: !!data?.refresh_token, email: data?.connected_email || null, connectedAt: data?.updated_at || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/google/connect", requireAuth, requireAdmin, (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(500).json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET não configurados no servidor" });
  const state = crypto.randomBytes(16).toString("hex");
  googleOAuthStates.set(state, Date.now());
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  res.json({ url });
});

app.get("/api/admin/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  res.header("Content-Type", "text/html; charset=utf-8");
  if (error) return res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">Conexão cancelada (${error}). Pode fechar esta aba.</body></html>`);
  if (!state || !googleOAuthStates.has(state)) return res.status(400).send("<html><body style=\"font-family:sans-serif;padding:40px;text-align:center\">Link inválido ou expirado. Volte ao JosephPay e tente conectar de novo.</body></html>");
  googleOAuthStates.delete(state);
  try {
    const tokenResp = await axios.post("https://oauth2.googleapis.com/token", new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: GOOGLE_REDIRECT_URI,
    }));
    const { access_token, refresh_token, expires_in } = tokenResp.data;
    const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
    let email = null;
    try {
      const info = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${access_token}` } });
      email = info.data?.email || null;
    } catch {}
    // Google só manda refresh_token na primeira autorização — se reconectar depois, preserva o antigo.
    const { data: existing } = await supabase.from("platform_google_auth").select("refresh_token").eq("id", 1).maybeSingle();
    await supabase.from("platform_google_auth").upsert({
      id: 1,
      access_token,
      refresh_token: refresh_token || existing?.refresh_token || null,
      expires_at,
      connected_email: email,
      updated_at: new Date().toISOString(),
    });
    res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">✅ Google conectado${email ? ` (${email})` : ""}.<br>Pode fechar esta aba e voltar ao JosephPay.</body></html>`);
  } catch (err) {
    console.error("[google/callback]", err.response?.data || err.message);
    res.status(500).send("<html><body style=\"font-family:sans-serif;padding:40px;text-align:center\">Erro ao conectar com o Google. Volte ao JosephPay e tente de novo.</body></html>");
  }
});

app.post("/api/admin/google/disconnect", requireAuth, requireAdmin, async (req, res) => {
  await supabase.from("platform_google_auth").delete().eq("id", 1);
  res.json({ ok: true });
});

app.get("/api/admin/google/tagmanager/accounts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const token = await getGoogleAccessToken();
    if (!token) return res.status(400).json({ error: "Google ainda não conectado" });
    const resp = await axios.get("https://www.googleapis.com/tagmanager/v2/accounts", { headers: { Authorization: `Bearer ${token}` } });
    res.json({ accounts: (resp.data.account || []).map(a => ({ id: a.accountId, name: a.name })) });
  } catch (err) {
    console.error("[gtm/accounts]", err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message || "";
    const projectMatch = msg.match(/project\s+(\d+)/i);
    const projectId = projectMatch?.[1] || "205225004807";
    if (err.response?.status === 403 || msg.includes("Tag Manager API") || msg.includes("disabled")) {
      return res.status(403).json({ error: `TAG_MANAGER_API_DISABLED:${projectId}` });
    }
    res.status(500).json({ error: describeGoogleAdsError(err) });
  }
});

app.get("/api/admin/google/tagmanager/containers", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { accountId } = req.query;
    if (!accountId) return res.status(400).json({ error: "accountId ausente" });
    const token = await getGoogleAccessToken();
    if (!token) return res.status(400).json({ error: "Google ainda não conectado" });
    const resp = await axios.get(`https://www.googleapis.com/tagmanager/v2/accounts/${accountId}/containers`, { headers: { Authorization: `Bearer ${token}` } });
    res.json({ containers: (resp.data.container || []).map(c => ({ id: c.containerId, name: c.name, publicId: c.publicId })) });
  } catch (err) {
    console.error("[gtm/containers]", err.response?.data || err.message);
    res.status(500).json({ error: describeGoogleAdsError(err) });
  }
});

app.post("/api/admin/producers/:id/gtm", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { account_id, container_id, container_name } = req.body;
    if (!account_id || !container_id) return res.status(400).json({ error: "account_id e container_id são obrigatórios" });
    const { error } = await supabase.from("profiles").update({
      gtm_account_id: account_id,
      gtm_container_id: container_id,
      gtm_container_name: container_name || null,
    }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/producers/:id/gtm/install-sensor", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    // Aceita account_id/container_id direto do corpo (o que está selecionado na tela agora) — evita
    // instalar num container antigo caso o admin tenha trocado a seleção sem clicar em "Vincular" de novo.
    let { account_id: accountId, container_id: containerId } = req.body || {};
    if (!accountId || !containerId) {
      const { data: profile } = await supabase.from("profiles").select("gtm_account_id,gtm_container_id").eq("id", id).maybeSingle();
      accountId = accountId || profile?.gtm_account_id;
      containerId = containerId || profile?.gtm_container_id;
    } else {
      await supabase.from("profiles").update({ gtm_account_id: accountId, gtm_container_id: containerId }).eq("id", id);
    }
    if (!accountId || !containerId) return res.status(400).json({ error: "Vincule um container do GTM a este cliente primeiro" });
    const token = await getGoogleAccessToken();
    if (!token) return res.status(400).json({ error: "Google ainda não conectado" });
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // Toda conta GTM já vem com uma "Default Workspace" — usamos a primeira disponível.
    const wsResp = await axios.get(`https://www.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces`, { headers });
    const workspace = (wsResp.data.workspace || [])[0];
    if (!workspace) return res.status(500).json({ error: "Nenhuma workspace encontrada nesse container" });
    const workspacePath = workspace.path;

    // Trigger próprio em vez do "All Pages" nativo — evita depender do ID interno do container.
    const triggerResp = await axios.post(`https://www.googleapis.com/tagmanager/v2/${workspacePath}/triggers`, {
      name: "JosephPay — Todas as páginas",
      type: "pageview",
    }, { headers });
    const triggerId = triggerResp.data.triggerId;

    const sensorSnippet = `<script src="${PUBLIC_URL}/sensor.js?uid=${id}"><\/script>`;
    await axios.post(`https://www.googleapis.com/tagmanager/v2/${workspacePath}/tags`, {
      name: "JosephPay — Sensor de visitas",
      type: "html",
      parameter: [{ type: "template", key: "html", value: sensorSnippet }],
      firingTriggerId: [triggerId],
    }, { headers });

    const versionResp = await axios.post(`https://www.googleapis.com/tagmanager/v2/${workspacePath}:create_version`, {
      name: `JosephPay — sensor instalado (${new Date().toLocaleDateString("pt-BR")})`,
    }, { headers });
    const containerVersionId = versionResp.data.containerVersion?.containerVersionId;
    if (containerVersionId) {
      await axios.post(`https://www.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/versions/${containerVersionId}:publish`, {}, { headers });
    }

    await supabase.from("profiles").update({ gtm_sensor_installed_at: new Date().toISOString() }).eq("id", id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[gtm/install-sensor]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || "Falha ao instalar o sensor via GTM" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — Google Ads (admin-only) — o admin é o gestor de tráfego dos produtores.
// Usa a MESMA conexão Google do GTM (platform_google_auth), só que também pede o
// escopo do Ads. Além disso precisa de um Developer Token do Google Ads — um só
// pra plataforma inteira (não por cliente), pedido direto ao Google fora daqui,
// e guardado na mesma linha de platform_google_auth (com fallback pra env var
// GOOGLE_ADS_DEVELOPER_TOKEN, caso prefira configurar assim) — e do customer_id
// da conta de Ads de cada produtor (esse sim, um por cliente, vinculado abaixo).
// IMPORTANTE: enquanto o developer token ou o customer_id não estiverem
// configurados, os endpoints de campanhas/anúncios/palavras-chave respondem
// {connected:false} — nunca inventamos número de gasto/campanha que não existe.
// Os números de contatos/clientes/faturamento/visitas SEMPRE são reais, vêm do
// que o JosephPay já rastreia (customers/sales/visits), com ou sem Ads conectado.
// ══════════════════════════════════════════════════════════════════════════════

async function getGoogleAdsDeveloperToken() {
  const { data } = await supabase.from("platform_google_auth").select("developer_token").eq("id", 1).maybeSingle();
  return data?.developer_token || GOOGLE_ADS_DEVELOPER_TOKEN || "";
}

async function getGoogleAdsManagerId() {
  const { data } = await supabase.from("platform_google_auth").select("manager_customer_id").eq("id", 1).maybeSingle();
  return (data?.manager_customer_id || "").replace(/\D/g, "");
}

const GOOGLE_ADS_API_VERSION = "v25";

// Roda uma consulta GAQL (linguagem de consulta do Google Ads) contra a conta de um
// cliente específico, passando pela conta de gerente quando configurada. Erros da API
// (token em modo teste, conta não vinculada, etc.) sobem pra quem chamou tratar.
async function googleAdsSearch(customerId, query) {
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) throw new Error("Google não conectado");
  const developerToken = await getGoogleAdsDeveloperToken();
  if (!developerToken) throw new Error("Developer Token não configurado");
  const managerId = await getGoogleAdsManagerId();
  const cleanCustomerId = String(customerId || "").replace(/\D/g, "");
  if (!cleanCustomerId) throw new Error("ID da conta de Ads inválido");
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (managerId) headers["login-customer-id"] = managerId;
  const resp = await axios.post(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}/googleAds:search`,
    { query },
    { headers }
  );
  return resp.data.results || [];
}

// A mensagem padrão do axios ("Request failed with status code X") não diz nada —
// o motivo real vem dentro do corpo do erro da Google Ads API. Monta uma mensagem
// que mostra o status HTTP + o motivo detalhado (quando a Google manda um), pra dar
// pra diagnosticar sem precisar olhar log de servidor.
function describeGoogleAdsError(err) {
  const status = err.response?.status;
  const gErr = err.response?.data?.error;
  const detail = gErr?.details?.find(d => Array.isArray(d.errors))?.errors?.[0];
  const reason = detail?.message || gErr?.message || err.message;
  return status ? `HTTP ${status} — ${reason}` : reason;
}

app.get("/api/admin/google-ads/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from("platform_google_auth").select("refresh_token,connected_email,developer_token,manager_customer_id").eq("id", 1).maybeSingle();
    // "Conectado" depende do refresh_token existir, não do e-mail — o e-mail é só exibição.
    res.json({
      googleConnected: !!data?.refresh_token,
      googleEmail: data?.connected_email || null,
      developerTokenConfigured: !!(data?.developer_token || GOOGLE_ADS_DEVELOPER_TOKEN),
      managerCustomerId: data?.manager_customer_id || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/google-ads/developer-token", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token?.trim()) return res.status(400).json({ error: "Cole o token antes de salvar" });
    const { error } = await supabase.from("platform_google_auth").upsert({ id: 1, developer_token: token.trim(), updated_at: new Date().toISOString() });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/google-ads/manager-id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { manager_id } = req.body;
    if (!manager_id?.trim()) return res.status(400).json({ error: "Cole o ID da conta de gerente antes de salvar" });
    const { error } = await supabase.from("platform_google_auth").upsert({ id: 1, manager_customer_id: manager_id.trim(), updated_at: new Date().toISOString() });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/producers/:id/google-ads", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_id } = req.body;
    const { error } = await supabase.from("profiles").update({ google_ads_customer_id: (customer_id || "").trim() || null }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Visão geral / Desempenho: números reais do JosephPay pro período pedido, com
// comparação ao período anterior de mesmo tamanho. Não depende do Ads estar
// conectado — é o que o admin já rastreia hoje (customers/sales/visits).
app.get("/api/admin/producers/:id/google-ads/overview", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 86400000);
    const rangeMs = Math.max(to.getTime() - from.getTime(), 86400000);
    const prevTo = new Date(from.getTime());
    const prevFrom = new Date(from.getTime() - rangeMs);

    const { data: profile } = await supabase.from("profiles").select("name,company_name,avatar_url,google_ads_customer_id").eq("id", id).maybeSingle();
    if (!profile) return res.status(404).json({ error: "Cliente não encontrado" });

    const periodStats = async (start, end) => {
      const [customersRes, salesRes, visitsRes] = await Promise.all([
        supabase.from("customers").select("id,status").eq("owner_id", id).is("deleted_at", null).gte("created_at", start.toISOString()).lt("created_at", end.toISOString()),
        supabase.from("sales").select("amount,gross_amount").eq("owner_id", id).eq("status", "pago").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()),
        supabase.from("visits").select("has_gclid").eq("owner_id", id).eq("event_type", "pageview").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()),
      ]);
      const customers = customersRes.data || [];
      const sales = salesRes.data || [];
      const visits = visitsRes.data || [];
      return {
        contatos: customers.length,
        interessados: customers.filter(c => c.status === "lead").length,
        clientes: customers.filter(c => c.status === "cliente" || c.status === "assinante").length,
        faturamento: Math.round(sales.reduce((a, s) => a + Number(s.gross_amount || s.amount || 0), 0) * 100) / 100,
        visitas: visits.length,
        visitasAnuncio: visits.filter(v => v.has_gclid).length,
      };
    };

    const [atual, anterior, developerToken] = await Promise.all([periodStats(from, to), periodStats(prevFrom, prevTo), getGoogleAdsDeveloperToken()]);
    const adsConnected = !!(profile.google_ads_customer_id && developerToken);

    // Investimento real, buscado na hora na Google Ads API — se a busca falhar (token
    // ainda em modo teste, conta não vinculada etc.), fica null e o motivo vai em adsError,
    // nunca inventamos o número.
    let investimento = null, adsError = null;
    if (adsConnected) {
      try {
        const fromStr = from.toISOString().slice(0, 10);
        const toStr = to.toISOString().slice(0, 10);
        const rows = await googleAdsSearch(profile.google_ads_customer_id, `SELECT metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${fromStr}' AND '${toStr}'`);
        const costMicros = rows.reduce((a, r) => a + Number(r.metrics?.costMicros || 0), 0);
        investimento = Math.round((costMicros / 1e6) * 100) / 100;
      } catch (err) {
        console.error("[google-ads/overview] busca real falhou:", err.response?.data || err.message);
        adsError = describeGoogleAdsError(err);
      }
    }

    res.json({
      cliente: { id, name: profile.name, company_name: profile.company_name, avatar_url: profile.avatar_url },
      adsConnected,
      adsError,
      googleAdsCustomerId: profile.google_ads_customer_id || null,
      periodo: { from: from.toISOString(), to: to.toISOString() },
      investimento,
      atual,
      anterior,
    });
  } catch (err) {
    console.error("[google-ads/overview]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Campanhas/Anúncios/Palavras-chave: dependem da Google Ads API de verdade (developer
// token + customer_id). Estrutura pronta pra plugar isso — até lá, resposta honesta
// de "não conectado", sem simular dado nenhum.
async function requireAdsConnection(profile) {
  const developerToken = await getGoogleAdsDeveloperToken();
  return !!(profile?.google_ads_customer_id && developerToken);
}
function adsDateRange(req) {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 86400000);
  return { fromStr: from.toISOString().slice(0, 10), toStr: to.toISOString().slice(0, 10) };
}

app.get("/api/admin/producers/:id/google-ads/campaigns", requireAuth, requireAdmin, async (req, res) => {
  const { data: profile } = await supabase.from("profiles").select("google_ads_customer_id").eq("id", req.params.id).maybeSingle();
  if (!(await requireAdsConnection(profile))) return res.json({ connected: false, campaigns: [] });
  try {
    const { fromStr, toStr } = adsDateRange(req);
    const rows = await googleAdsSearch(profile.google_ads_customer_id, `
      SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions
      FROM campaign
      WHERE segments.date BETWEEN '${fromStr}' AND '${toStr}'
      ORDER BY metrics.cost_micros DESC
    `);
    const campaigns = rows.map(r => ({
      id: r.campaign?.id, name: r.campaign?.name, status: r.campaign?.status,
      cost: Number(r.metrics?.costMicros || 0) / 1e6,
      clicks: Number(r.metrics?.clicks || 0),
      impressions: Number(r.metrics?.impressions || 0),
    }));
    res.json({ connected: true, campaigns });
  } catch (err) {
    console.error("[google-ads/campaigns]", err.response?.data || err.message);
    res.json({ connected: true, campaigns: [], error: describeGoogleAdsError(err) });
  }
});
app.get("/api/admin/producers/:id/google-ads/ads", requireAuth, requireAdmin, async (req, res) => {
  const { data: profile } = await supabase.from("profiles").select("google_ads_customer_id").eq("id", req.params.id).maybeSingle();
  if (!(await requireAdsConnection(profile))) return res.json({ connected: false, ads: [] });
  try {
    const { fromStr, toStr } = adsDateRange(req);
    const rows = await googleAdsSearch(profile.google_ads_customer_id, `
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status,
             ad_group_ad.ad.responsive_search_ad.headlines, metrics.clicks, metrics.impressions, metrics.cost_micros
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${fromStr}' AND '${toStr}'
      ORDER BY metrics.cost_micros DESC
    `);
    const ads = rows.map(r => {
      const headline = r.adGroupAd?.ad?.responsiveSearchAd?.headlines?.[0]?.text || r.adGroupAd?.ad?.name || r.adGroupAd?.ad?.type || "Anúncio";
      return {
        id: r.adGroupAd?.ad?.id, headline, status: r.adGroupAd?.status,
        cost: Number(r.metrics?.costMicros || 0) / 1e6,
        clicks: Number(r.metrics?.clicks || 0),
        impressions: Number(r.metrics?.impressions || 0),
      };
    });
    res.json({ connected: true, ads });
  } catch (err) {
    console.error("[google-ads/ads]", err.response?.data || err.message);
    res.json({ connected: true, ads: [], error: describeGoogleAdsError(err) });
  }
});
app.get("/api/admin/producers/:id/google-ads/keywords", requireAuth, requireAdmin, async (req, res) => {
  const { data: profile } = await supabase.from("profiles").select("google_ads_customer_id").eq("id", req.params.id).maybeSingle();
  if (!(await requireAdsConnection(profile))) return res.json({ connected: false, keywords: [] });
  try {
    const { fromStr, toStr } = adsDateRange(req);
    const rows = await googleAdsSearch(profile.google_ads_customer_id, `
      SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
             metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.ctr
      FROM keyword_view
      WHERE segments.date BETWEEN '${fromStr}' AND '${toStr}'
      ORDER BY metrics.clicks DESC
    `);
    const keywords = rows.map(r => ({
      text: r.adGroupCriterion?.keyword?.text,
      matchType: r.adGroupCriterion?.keyword?.matchType,
      clicks: Number(r.metrics?.clicks || 0),
      impressions: Number(r.metrics?.impressions || 0),
      ctr: Number(r.metrics?.ctr || 0),
      cost: Number(r.metrics?.costMicros || 0) / 1e6,
    }));
    res.json({ connected: true, keywords });
  } catch (err) {
    console.error("[google-ads/keywords]", err.response?.data || err.message);
    res.json({ connected: true, keywords: [], error: describeGoogleAdsError(err) });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS — Integração GitHub (admin-only) — instala o sensor com um commit
// direto no repositório do site, pra quando o site do cliente é código
// próprio mantido pelo admin/equipe (não pelo produtor).
// ══════════════════════════════════════════════════════════════════════════════

const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI  = `${PUBLIC_URL}/api/admin/github/callback`;

const githubOAuthStates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [state, ts] of githubOAuthStates) if (now - ts > 10 * 60 * 1000) githubOAuthStates.delete(state);
}, 5 * 60 * 1000);

async function getGithubToken() {
  const { data: row } = await supabase.from("platform_github_auth").select("access_token").eq("id", 1).maybeSingle();
  return row?.access_token || null;
}

app.get("/api/admin/github/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from("platform_github_auth").select("connected_login,updated_at").eq("id", 1).maybeSingle();
    res.json({ connected: !!data?.connected_login, login: data?.connected_login || null, connectedAt: data?.updated_at || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/github/connect", requireAuth, requireAdmin, (req, res) => {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) return res.status(500).json({ error: "GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET não configurados no servidor" });
  const state = crypto.randomBytes(16).toString("hex");
  githubOAuthStates.set(state, Date.now());
  const url = "https://github.com/login/oauth/authorize?" + new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: "repo",
    state,
  });
  res.json({ url });
});

app.get("/api/admin/github/callback", async (req, res) => {
  const { code, state, error } = req.query;
  res.header("Content-Type", "text/html; charset=utf-8");
  if (error) return res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">Conexão cancelada (${error}). Pode fechar esta aba.</body></html>`);
  if (!state || !githubOAuthStates.has(state)) return res.status(400).send("<html><body style=\"font-family:sans-serif;padding:40px;text-align:center\">Link inválido ou expirado. Volte ao JosephPay e tente conectar de novo.</body></html>");
  githubOAuthStates.delete(state);
  try {
    const tokenResp = await axios.post("https://github.com/login/oauth/access_token", {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_REDIRECT_URI,
    }, { headers: { Accept: "application/json" } });
    const { access_token, error: tokenError } = tokenResp.data;
    if (!access_token) throw new Error(tokenError || "Token não retornado pelo GitHub");
    let login = null;
    try {
      const info = await axios.get("https://api.github.com/user", { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/vnd.github+json" } });
      login = info.data?.login || null;
    } catch {}
    await supabase.from("platform_github_auth").upsert({
      id: 1,
      access_token,
      connected_login: login,
      updated_at: new Date().toISOString(),
    });
    res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">✅ GitHub conectado${login ? ` (${login})` : ""}.<br>Pode fechar esta aba e voltar ao JosephPay.</body></html>`);
  } catch (err) {
    console.error("[github/callback]", err.response?.data || err.message);
    res.status(500).send("<html><body style=\"font-family:sans-serif;padding:40px;text-align:center\">Erro ao conectar com o GitHub. Volte ao JosephPay e tente de novo.</body></html>");
  }
});

app.post("/api/admin/github/disconnect", requireAuth, requireAdmin, async (req, res) => {
  await supabase.from("platform_github_auth").delete().eq("id", 1);
  res.json({ ok: true });
});

app.get("/api/admin/github/repos", requireAuth, requireAdmin, async (req, res) => {
  try {
    const token = await getGithubToken();
    if (!token) return res.status(400).json({ error: "GitHub ainda não conectado" });
    const resp = await axios.get("https://api.github.com/user/repos", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      params: { per_page: 100, sort: "updated" },
    });
    res.json({ repos: (resp.data || []).map(r => ({ fullName: r.full_name, defaultBranch: r.default_branch })) });
  } catch (err) {
    console.error("[github/repos]", err.response?.data || err.message);
    res.status(500).json({ error: "Falha ao buscar repositórios do GitHub" });
  }
});

// Detecta o arquivo principal do site num repo GitHub, ignorando arquivos que
// o próprio JosephPay criou (minichat.html). Funciona pra HTML, Vite/React, Next.js, SvelteKit.
async function detectSiteEntryFile(allPaths) {
  // 1. HTML padrão (Vite, sites simples, SvelteKit)
  const HTML_PRIORITY = ["index.html", "public/index.html", "src/app.html", "src/index.html"];
  let f = HTML_PRIORITY.find(p => allPaths.includes(p));
  if (f) return { file: f, type: "html" };
  // 2. Next.js App Router
  f = allPaths.find(p => /^(src\/)?app\/layout\.[jt]sx?$/.test(p));
  if (f) return { file: f, type: "nextjs-app" };
  // 3. Next.js Pages Router
  f = allPaths.find(p => /^(src\/)?pages\/_document\.[jt]sx?$/.test(p));
  if (f) return { file: f, type: "nextjs-pages" };
  // 4. TanStack Router __root (tem <head> JSX onde o sensor pode ser injetado)
  f = allPaths.find(p => /^src\/routes\/__root\.[jt]sx?$/.test(p));
  if (f) return { file: f, type: "react-main" };
  // 5. React/Vite main entry (src/main.tsx etc.)
  f = allPaths.find(p => /^(src\/)(main|index)\.[jt]sx?$/.test(p));
  if (f) return { file: f, type: "react-main" };
  // 6. Qualquer HTML que NÃO seja do minichat (último recurso)
  const anyHtml = allPaths.filter(p => /\.html?$/i.test(p) && !/minichat/i.test(p))
    .sort((a,b) => a.split("/").length - b.split("/").length)[0];
  if (anyHtml) return { file: anyHtml, type: "html" };
  // 7. Qualquer .tsx/.jsx em src/ — TanStack, CRA, Vite sem index.html
  const TSX_CANDIDATES = [
    "src/routes/__root.tsx","src/routes/__root.jsx",
    "src/App.tsx","src/App.jsx",
    "src/main.tsx","src/main.jsx",
  ];
  f = TSX_CANDIDATES.find(p => allPaths.includes(p));
  if (f) return { file: f, type: "react-main" };
  const anyTsx = allPaths.find(p => /^src\/.*\.[jt]sx?$/.test(p) && !/(^|\/)(node_modules|dist|build)\//i.test(p));
  if (anyTsx) return { file: anyTsx, type: "react-main" };
  return null;
}

app.get("/api/admin/github/repo-files", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { repo } = req.query;
    if (!repo) return res.status(400).json({ error: "repo ausente" });
    const token = await getGithubToken();
    if (!token) return res.status(400).json({ error: "GitHub ainda não conectado" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    const repoInfo = await axios.get(`https://api.github.com/repos/${repo}`, { headers });
    const branch = repoInfo.data.default_branch;
    const treeResp = await axios.get(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}`, { headers, params: { recursive: 1 } });
    const tree = treeResp.data.tree || [];
    const allPaths = tree.filter(i => i.type === "blob").map(i => i.path);

    const detected = await detectSiteEntryFile(allPaths);
    const autoFile = detected?.file || null;
    const fileType = detected?.type || "html";

    const htmlFiles = allPaths.filter(p => /\.html?$/i.test(p) && !/minichat/i.test(p))
      .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    if (htmlFiles.length) return res.json({ files: htmlFiles, htmlFound: true, autoFile, fileType });

    const PRIORIDADE = /(_root|app|layout|index|router)\.[jt]sx?$/i;
    const sourceFiles = allPaths
      .filter(p => /\.(tsx|jsx|ts|js)$/i.test(p) && !/(^|\/)(node_modules|dist|build|\.next)\//i.test(p))
      .sort((a, b) => {
        const pa = PRIORIDADE.test(a) ? 0 : 1, pb = PRIORIDADE.test(b) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return a.split("/").length - b.split("/").length || a.localeCompare(b);
      })
      .slice(0, 200);
    res.json({ files: sourceFiles, htmlFound: false, autoFile, fileType });
  } catch (err) {
    console.error("[github/repo-files]", err.response?.data || err.message);
    res.status(500).json({ error: "Falha ao listar os arquivos do repositório" });
  }
});

// Lê o conteúdo de um arquivo do repositório (com fallback pra arquivos grandes,
// que a Contents API não devolve inline) — usado tanto pelo scan simples quanto
// pelo scan de código React abaixo.
async function readGithubFile(repo, filePath, headers, token) {
  const resp = await axios.get(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, { headers });
  if (resp.data.content) return Buffer.from(resp.data.content, "base64").toString("utf8");
  if (resp.data.download_url) {
    const raw = await axios.get(resp.data.download_url, { headers: { Authorization: `Bearer ${token}` } });
    return typeof raw.data === "string" ? raw.data : JSON.stringify(raw.data);
  }
  return "";
}

// Extrai todos os "links" de verdade de um arquivo (HTML ou código-fonte React) — não
// só <a href>, porque muitos botões (principalmente os que abrem WhatsApp) são feitos
// via onClick + window.open/window.location em vez de um <a> de verdade. Chama registra()
// pra cada ocorrência encontrada.
function extractLinksFromContent(content, filePath, registra, varMap = {}) {
  let m;
  const reHref = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = reHref.exec(content))) registra(m[1], m[2], filePath);
  const reLink = /<Link\b[^>]*\bto\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/Link>/gi;
  while ((m = reLink.exec(content))) registra(m[1], m[2], filePath);
  // href/to passado como expressão JSX com string estática: href={"..."} ou href={'...'}
  const reHrefExpr = /\b(?:href|to)\s*=\s*\{\s*["'`]([^"'`]+)["'`]\s*\}/gi;
  while ((m = reHrefExpr.exec(content))) registra(m[1], "(atributo href={...})", filePath);
  // href/to passado como variável JSX — ex: href={WHATSAPP_URL}; resolve do varMap se possível
  const reHrefVar = /\b(?:href|to)\s*=\s*\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  while ((m = reHrefVar.exec(content))) {
    const varName = m[1];
    const resolved = varMap[varName];
    if (resolved) registra(resolved, `(variável: ${varName})`, filePath);
    else registra(`{${varName}}`, `(variável: ${varName})`, filePath);
  }
  // botão que redireciona via JS em vez de <a href> — comum pra abrir WhatsApp num onClick
  const reWinOpen = /window\.open\(\s*["'`]([^"'`]+)["'`]/gi;
  while ((m = reWinOpen.exec(content))) registra(m[1], "(window.open no código)", filePath);
  const reWinLoc = /window\.location(?:\.href)?\s*=\s*["'`]([^"'`]+)["'`]/gi;
  while ((m = reWinLoc.exec(content))) registra(m[1], "(window.location no código)", filePath);
  const reWa = /["'`](https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^"'`\s]*)["'`]/gi;
  while ((m = reWa.exec(content))) registra(m[1], "(link de WhatsApp no código)", filePath);
  // Template literals com URL — ex: `https://wa.me/${phone}` ou `https://site.com/pagina`
  const reTemplateUrl = /`(https?:\/\/[^`\n]{5,})`/gi;
  while ((m = reTemplateUrl.exec(content))) {
    const url = m[1].replace(/\$\{[^}]+\}/g, '{...}');
    registra(url, "(URL em template literal)", filePath);
  }
  // tel: e mailto: como string
  const reTelMail = /["'`]((?:tel|mailto):[^"'`\s<>]{3,})["'`]/gi;
  while ((m = reTelMail.exec(content))) registra(m[1], "(link de contato)", filePath);
  // router.push / navigate com rota estática
  const reRouterPush = /(?:router|navigate)\s*(?:\.push)?\s*\(\s*["'`]([^"'`\n]+)["'`]/gi;
  while ((m = reRouterPush.exec(content))) registra(m[1], "(router.push)", filePath);
}

// Sites feitos no Lovable (ou qualquer app em React/Vite) não têm botões dentro do
// index.html — a página raiz só carrega o JS, e os botões de verdade vivem dentro do
// código-fonte (.tsx/.jsx), renderizados no navegador. Quando o scan simples não acha
// nada, varre os arquivos de código do repositório procurando href="…", <Link to="…">
// e links de WhatsApp escritos direto no código (comum em onClick).
async function scanRepoJsxLinks(repo, headers, token) {
  const repoInfo = await axios.get(`https://api.github.com/repos/${repo}`, { headers });
  const branch = repoInfo.data.default_branch;
  const treeResp = await axios.get(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}`, { headers, params: { recursive: 1 } });
  const arquivos = (treeResp.data.tree || [])
    .filter(item => item.type === "blob" && /\.(tsx|jsx|ts|js|html?)$/i.test(item.path) && !/(^|\/)(node_modules|dist|build|\.next)\//i.test(item.path))
    .slice(0, 80);

  const groups = {};
  const registra = (href, text, filePath) => {
    href = (href || "").trim();
    if (!href || href.startsWith("#")) return;
    const key = `${filePath}::${href}`;
    if (!groups[key]) groups[key] = { href, file: filePath, count: 0, samples: [] };
    groups[key].count++;
    text = (text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (text && groups[key].samples.length < 3 && !groups[key].samples.includes(text)) groups[key].samples.push(text);
  };

  // Pré-lê arquivos de constantes (lib/site.ts, constants.ts, etc.) pra resolver
  // variáveis como href={WHATSAPP_URL} que o scan de JSX não consegue ver diretamente.
  const varMap = {};
  const constFiles = arquivos.filter(f => /\b(site|constants?|config|urls?)\.(ts|js)$/i.test(f.path));
  await Promise.all(constFiles.map(async f => {
    try {
      const c = await readGithubFile(repo, f.path, headers, token);
      // export const VARNAME = "https://..." (valor pode estar na mesma linha ou na seguinte)
      const reConst = /export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:[\r\n]\s*)?["'`](https?:\/\/[^"'`\n]+)["'`]/g;
      let cm;
      while ((cm = reConst.exec(c))) varMap[cm[1]] = cm[2];
    } catch {}
  }));

  // Processa em lotes pra não estourar o rate limit da API do GitHub nem demorar demais.
  const LOTE = 10;
  for (let i = 0; i < arquivos.length; i += LOTE) {
    const lote = arquivos.slice(i, i + LOTE);
    await Promise.all(lote.map(async item => {
      let content;
      try { content = await readGithubFile(repo, item.path, headers, token); }
      catch { return; }
      extractLinksFromContent(content, item.path, registra, varMap);
    }));
  }
  return Object.values(groups).sort((a, b) => b.count - a.count);
}

// Lê os links (<a href>) que existem de verdade num arquivo do repositório — pra mostrar
// pro admin escolher quais devem passar a apontar pro Mini Chat, antes de aplicar qualquer coisa.
app.get("/api/admin/github/scan-links", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { repo, file } = req.query;
    if (!repo) return res.status(400).json({ error: "repo é obrigatório" });
    const token = await getGithubToken();
    if (!token) return res.status(400).json({ error: "GitHub ainda não conectado" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

    // Sempre varre o repositório inteiro — assim funciona tanto pra sites HTML quanto
    // React/Lovable/Vite onde os botões vivem em .tsx/.jsx. O `file` param é opcional
    // e ignorado: escanear tudo é mais robusto e evita o bug do caminho errado.
    const links = await scanRepoJsxLinks(repo, headers, token);
    res.json({ links, source: "code" });
  } catch (err) {
    console.error("[github/scan-links]", err.response?.data || err.message);
    res.status(500).json({ error: "Falha ao ler os links do repositório" });
  }
});

// Aplica só os links escolhidos pelo admin, trocando o href exato de cada um pro link do
// Mini Chat desse cliente — substituição direta de texto, sem adivinhar nada.
app.post("/api/admin/producers/:id/github/apply-links", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    // Aceita tanto o formato antigo ({hrefs:[...]}, sempre no arquivo vinculado) quanto
    // o novo ({links:[{href,file}]}), usado quando os links vieram do scan de código
    // React (podem estar espalhados em vários arquivos .tsx diferentes).
    const { hrefs, links } = req.body;
    const { data: profile } = await supabase.from("profiles").select("github_repo,github_file_path").eq("id", id).maybeSingle();
    if (!profile?.github_repo) return res.status(400).json({ error: "Vincule um repositório a este cliente primeiro" });
    const itens = Array.isArray(links) ? links : Array.isArray(hrefs) ? hrefs.map(href => ({ href, file: profile.github_file_path })) : [];
    if (!itens.length) return res.status(400).json({ error: "Nenhum link selecionado" });
    const token = await getGithubToken();
    if (!token) return res.status(400).json({ error: "GitHub ainda não conectado" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    const repo = profile.github_repo;
    const minichatLink = `https://josephpay.com/minichat.html?uid=${id}`;

    const porArquivo = {};
    itens.forEach(({ href, file }) => {
      if (!href || !file) return;
      (porArquivo[file] = porArquivo[file] || []).push(href);
    });
    if (!Object.keys(porArquivo).length) return res.status(400).json({ error: "Nenhum link selecionado" });

    let changed = 0;
    for (const [filePath, hrefsDoArquivo] of Object.entries(porArquivo)) {
      const fileResp = await axios.get(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, { headers });
      const sha = fileResp.data.sha;
      let content = Buffer.from(fileResp.data.content, "base64").toString("utf8");
      let mudouAqui = false;
      hrefsDoArquivo.forEach(href => {
        const escaped = String(href).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const before = content;
        // 1) atributo href="…" ou to="…" (HTML ou <Link> do React Router)
        content = content.replace(new RegExp(`(href|to)(\\s*=\\s*)(["'])${escaped}\\3`, "g"), `$1$2$3${minichatLink}$3`);
        // 2) qualquer outra ocorrência entre aspas (ex: link de WhatsApp usado direto
        //    num onClick, sem estar num atributo href/to)
        content = content.replace(new RegExp(`(["'\`])${escaped}\\1`, "g"), `$1${minichatLink}$1`);
        if (content !== before) { changed++; mudouAqui = true; }
      });
      if (!mudouAqui) continue;
      await axios.put(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, {
        message: "JosephPay: aponta botões do site pro Mini Chat",
        content: Buffer.from(content, "utf8").toString("base64"),
        sha,
      }, { headers });
    }
    if (!changed) return res.status(400).json({ error: "Nenhum dos links selecionados foi encontrado — o arquivo pode ter mudado desde a última leitura. Recarregue a lista e tente de novo." });

    res.json({ ok: true, changed });
  } catch (err) {
    console.error("[github/apply-links]", err.response?.data || err.message);
    res.status(500).json({ error: "Falha ao aplicar os links no repositório" });
  }
});

// Prepara o repositório para deploy na Vercel — commita um vercel.json adequado ao tipo de
// projeto (HTML estático, Vite, Next.js). Assim o produtor só precisa importar no painel da Vercel.
app.post("/api/admin/producers/:id/github/prepare-vercel", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: profile } = await supabase.from("profiles").select("github_repo,github_file_path").eq("id", id).maybeSingle();
    if (!profile?.github_repo) return res.status(400).json({ error: "Vincule um repositório a este cliente primeiro" });
    const repo = profile.github_repo;
    const token = await getGithubToken();
    if (!token) return res.status(400).json({ error: "GitHub ainda não conectado" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

    // Detecta o tipo de projeto analisando os arquivos do repo
    const treeResp = await axios.get(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`, { headers });
    const allPaths = (treeResp.data.tree || []).filter(i => i.type === "blob").map(i => i.path);

    let vercelConfig;
    const hasPackageJson = allPaths.includes("package.json");
    const hasViteConfig  = allPaths.some(p => /^vite\.config\.[jt]s$/.test(p));
    const hasNextConfig  = allPaths.some(p => /^next\.config\.[jt]sx?$/.test(p));
    const hasTanStack    = allPaths.some(p => /^src\/routes\/__root\.[jt]sx?$/.test(p));

    if (hasNextConfig) {
      vercelConfig = { framework: "nextjs" };
    } else if (hasViteConfig || hasTanStack) {
      vercelConfig = {
        buildCommand: "npm run build",
        outputDirectory: "dist",
        framework: "vite",
        rewrites: [{ source: "/(.*)", destination: "/index.html" }]
      };
    } else if (hasPackageJson) {
      vercelConfig = {
        buildCommand: "npm run build",
        outputDirectory: "dist",
        rewrites: [{ source: "/(.*)", destination: "/index.html" }]
      };
    } else {
      // HTML estático puro
      vercelConfig = {
        cleanUrls: true,
        trailingSlash: false
      };
    }

    // Verifica se já existe vercel.json
    let existingSha = null;
    try {
      const existing = await axios.get(`https://api.github.com/repos/${repo}/contents/vercel.json`, { headers });
      existingSha = existing.data.sha;
      // Já existe — verifica se é diferente antes de atualizar
      const existingContent = Buffer.from(existing.data.content, "base64").toString("utf8");
      if (existingContent === JSON.stringify(vercelConfig, null, 2) + "\n") {
        return res.json({ ok: true, already: true, config: vercelConfig });
      }
    } catch (e) {
      if (e.response?.status !== 404) throw e;
    }

    const body = {
      message: "JosephPay: prepara repositório pra deploy na Vercel",
      content: Buffer.from(JSON.stringify(vercelConfig, null, 2) + "\n", "utf8").toString("base64"),
    };
    if (existingSha) body.sha = existingSha;
    await axios.put(`https://api.github.com/repos/${repo}/contents/vercel.json`, body, { headers });
    await supabase.from("profiles").update({ github_vercel_ready_at: new Date().toISOString() }).eq("id", id);
    res.json({ ok: true, config: vercelConfig });
  } catch (err) {
    console.error("[github/prepare-vercel]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || "Falha ao preparar o repositório para a Vercel" });
  }
});

// Instala uma "porta de entrada" do Mini Chat dentro do repositório do cliente — um arquivo
// leve que só abre o Mini Chat central do JosephPay. Assim o arquivo existe de verdade no
// repositório, mas o motor continua um só: melhorias futuras chegam pra todos sozinhas.
app.post("/api/admin/producers/:id/github/install-minichat", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let filePath = (req.body?.file_path || "minichat.html").trim().replace(/^\/+/, "");
    if (!filePath) return res.status(400).json({ error: "Caminho do arquivo é obrigatório" });
    const { data: profile } = await supabase.from("profiles").select("github_repo").eq("id", id).maybeSingle();
    if (!profile?.github_repo) return res.status(400).json({ error: "Vincule um repositório a este cliente primeiro" });
    const token = await getGithubToken();
    if (!token) return res.status(400).json({ error: "GitHub ainda não conectado" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    const repo = profile.github_repo;
    const minichatLink = `https://josephpay.com/minichat.html?uid=${id}`;
    const loaderHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="0;url=${minichatLink}">
<title>Mini Chat</title>
<script>window.location.replace(${JSON.stringify(minichatLink)});<\/script>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font-family:sans-serif">
<p>Redirecionando…</p>
</body>
</html>
`;
    let sha;
    try {
      const existing = await axios.get(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, { headers });
      sha = existing.data.sha;
    } catch (e) {
      if (e.response?.status !== 404) throw e;
    }
    await axios.put(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, {
      message: "JosephPay: instala página do Mini Chat",
      content: Buffer.from(loaderHtml, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
    }, { headers });
    await supabase.from("profiles").update({ github_minichat_path: filePath, github_minichat_installed_at: new Date().toISOString() }).eq("id", id);
    res.json({ ok: true, file_path: filePath });
  } catch (err) {
    console.error("[github/install-minichat]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || "Falha ao instalar o Mini Chat no repositório" });
  }
});

// Prepara o repositório do cliente pra ser importado direto na Vercel — sem
// precisar pedir pra outra IA arrumar isso toda vez. Detecta se é um projeto
// Vite (Lovable sempre gera Vite+React) e cria/atualiza o vercel.json com o

app.post("/api/admin/producers/:id/github", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { repo, file_path } = req.body;
    if (!repo?.trim() || !file_path?.trim()) return res.status(400).json({ error: "repo e file_path são obrigatórios" });
    const { error } = await supabase.from("profiles").update({
      github_repo: repo.trim(),
      github_file_path: file_path.trim(),
    }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/producers/:id/github/install-sensor", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let { repo } = req.body || {};
    const { data: profile } = await supabase.from("profiles").select("github_repo,github_file_path").eq("id", id).maybeSingle();
    repo = repo?.trim() || profile?.github_repo;
    let filePath = profile?.github_file_path;
    if (!repo) return res.status(400).json({ error: "Vincule um repositório GitHub a este cliente primeiro" });
    const token = await getGithubToken();
    if (!token) return res.status(400).json({ error: "GitHub ainda não conectado" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

    // Valida se o caminho armazenado é válido; se não, auto-detecta no repo
    const isBadPath = !filePath || filePath === ".html" || filePath.startsWith(".") || /minichat/i.test(filePath);
    let repoTree = null;
    const getRepoTree = async () => {
      if (repoTree) return repoTree;
      const treeResp = await axios.get(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`, { headers });
      repoTree = (treeResp.data.tree || []).filter(i => i.type === "blob").map(i => i.path);
      return repoTree;
    };

    if (isBadPath) {
      const allPaths = await getRepoTree();
      const detected = await detectSiteEntryFile(allPaths);
      if (!detected) return res.status(400).json({ error: "Não encontrei nenhum arquivo de entrada nesse repositório. Verifique se o repositório tem código enviado." });
      filePath = detected.file;
      await supabase.from("profiles").update({ github_file_path: filePath }).eq("id", id);
    }

    // Tenta ler o arquivo com fallbacks (index.html → public/index.html → TSX entry)
    let fileResp = null;
    const pathsToTry = [filePath];
    if (filePath === "index.html") pathsToTry.push("public/index.html");
    else if (filePath === "public/index.html") pathsToTry.push("index.html");

    for (const tryPath of pathsToTry) {
      try {
        fileResp = await axios.get(`https://api.github.com/repos/${repo}/contents/${encodeURI(tryPath)}`, { headers });
        if (tryPath !== filePath) {
          filePath = tryPath;
          await supabase.from("profiles").update({ github_file_path: filePath }).eq("id", id);
        }
        break;
      } catch (e) {
        if (e.response?.status !== 404) throw e;
      }
    }

    // Se não achou HTML, busca TSX/JSX de entrada no repo
    if (!fileResp) {
      const allPaths = await getRepoTree();
      const TSX_CANDIDATES = [
        "src/routes/__root.tsx","src/routes/__root.jsx",
        "src/App.tsx","src/App.jsx",
        "src/main.tsx","src/main.jsx",
        "src/index.tsx","src/index.jsx",
      ];
      const tsxEntry = TSX_CANDIDATES.find(p => allPaths.includes(p))
        || allPaths.find(p => /^src\/.*\.[jt]sx?$/.test(p) && !/(node_modules|dist|build)/.test(p));
      if (tsxEntry) {
        fileResp = await axios.get(`https://api.github.com/repos/${repo}/contents/${encodeURI(tsxEntry)}`, { headers });
        filePath = tsxEntry;
        await supabase.from("profiles").update({ github_file_path: filePath }).eq("id", id);
      }
    }

    if (!fileResp) {
      return res.status(400).json({ error: "Não encontrei nenhum arquivo de entrada nesse repositório. Certifique-se de que o projeto já tem código publicado no GitHub." });
    }

    const sha = fileResp.data.sha;
    const currentContent = Buffer.from(fileResp.data.content, "base64").toString("utf8");
    const sensorSnippet = `<script src="${PUBLIC_URL}/sensor.js?uid=${id}"><\/script>`;

    if (currentContent.includes(`sensor.js?uid=${id}`)) {
      await supabase.from("profiles").update({ github_sensor_installed_at: new Date().toISOString() }).eq("id", id);
      return res.json({ ok: true, already: true, file: filePath });
    }

    let newContent;
    if (currentContent.match(/<\/head>/i)) {
      newContent = currentContent.replace(/<\/head>/i, `  ${sensorSnippet}\n</head>`);
    } else if (/\.[jt]sx?$/.test(filePath)) {
      // ES module: inject AFTER the last import/require line so the IIFE doesn't
      // appear before import statements (SyntaxError in strict ES modules / Vite).
      const loader = `\n// JosephPay sensor\n(function(){var s=document.createElement('script');s.src='${PUBLIC_URL}/sensor.js?uid=${id}';document.head.appendChild(s);})();\n`;
      const lines = currentContent.split('\n');
      let lastImportLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*(import\s|import\(|require\s*\()/.test(lines[i])) lastImportLine = i;
      }
      if (lastImportLine >= 0) {
        lines.splice(lastImportLine + 1, 0, loader);
        newContent = lines.join('\n');
      } else {
        // No imports found — append at end of file
        newContent = currentContent + loader;
      }
    } else {
      return res.status(400).json({ error: `Arquivo ${filePath} detectado mas não tem <\/head>. Copie a tag <script> manualmente antes de <\/head>.` });
    }

    await axios.put(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, {
      message: "JosephPay: instala sensor de visitas",
      content: Buffer.from(newContent, "utf8").toString("base64"),
      sha,
    }, { headers });

    await supabase.from("profiles").update({ github_sensor_installed_at: new Date().toISOString(), github_file_path: filePath }).eq("id", id);
    res.json({ ok: true, file: filePath });
  } catch (err) {
    console.error("[github/install-sensor]", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || "Falha ao instalar o sensor via GitHub" });
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
 * Puxa os últimos 90 dias do Mercado Pago e salva em sales.
 */
app.post("/api/sync/history", requireAuth, async (req, res) => {
  try {
    const uid   = req.user.id;
    const since = new Date(Date.now() - 90 * 86400000).toISOString();

    let mpPayments = [];
    try {
      const r = await mp.get(`/v1/payments/search?status=approved&begin_date=${since}&limit=100&offset=0`);
      mpPayments = r.data?.results || [];
    } catch (e) {
      console.warn("[sync/history] MP fetch error:", e.message);
    }

    const { data: existingSales } = await supabase.from("sales").select("asaas_id").eq("owner_id", uid);
    const existingIds = new Set((existingSales || []).map(s => s.asaas_id));

    let inserted = 0, skipped = 0, errors = 0;

    for (const payment of mpPayments) {
      const mpId = String(payment.id);
      if (existingIds.has(mpId)) { skipped++; continue; }

      const grossAmount = Number(payment.transaction_amount || 0);
      const mpFee       = (payment.fee_details || []).reduce((a, f) => a + Number(f.amount || 0), 0);
      const netAmount   = Math.max(0, grossAmount - mpFee);
      const { platformFee, asaasFee, producerAmount } = calcFees(grossAmount, netAmount);
      const paymentDate = payment.date_approved
        ? new Date(payment.date_approved).toISOString()
        : new Date().toISOString();

      // Identifica owner via external_reference
      let ownerId = uid;
      const extRef = payment.external_reference || "";
      if (extRef.startsWith("owner_")) ownerId = extRef.replace("owner_", "");

      // Cria/atualiza customer pelo email
      let customerId = null;
      const payerEmail = payment.payer?.email;
      if (payerEmail) {
        const payerName = [payment.payer?.first_name, payment.payer?.last_name].filter(Boolean).join(" ") || "Cliente";
        const { data: existCust } = await supabase.from("customers")
          .select("id").eq("email", payerEmail).eq("owner_id", ownerId).maybeSingle();
        if (existCust) {
          customerId = existCust.id;
        } else {
          const { data: newCust } = await supabase.from("customers")
            .insert({ name: payerName, email: payerEmail, owner_id: ownerId })
            .select("id").maybeSingle();
          customerId = newCust?.id || null;
        }
      }

      const salePayload = {
        owner_id:          ownerId,
        customer_id:       customerId,
        amount:            grossAmount,
        gross_amount:      grossAmount,
        net_amount:        netAmount,
        asaas_fee:         mpFee,
        platform_fee:      platformFee,
        producer_amount:   producerAmount,
        billing_type:      (payment.payment_type_id || "UNKNOWN").toUpperCase(),
        payment_date:      paymentDate,
        status:            "pago",
        asaas_id:          mpId,
        created_at:        paymentDate,
      };

      const { error: insErr } = await supabase.from("sales").insert(salePayload);
      if (insErr) { console.warn("[sync/history] insert error:", insErr.message); errors++; }
      else { inserted++; existingIds.add(mpId); }
    }

    console.log(`[sync/history] user=${uid} — inserted:${inserted} skipped:${skipped} errors:${errors}`);
    res.json({ inserted, skipped, errors, total: mpPayments.length });
  } catch (err) {
    console.error("[sync/history]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS PÚBLICAS — checkout próprio (sem autenticação)
// ══════════════════════════════════════════════════════════════════════════════

// Taxas Mercado Pago — iguais ao checkout.html
const MP_SERVER_RATES = {
  PIX:    { fixed: 0, pct: 0.0099 },
  BOLETO: { fixed: 3.49, pct: 0 },
  CC:     { fixed: 0, pct: 0.0449 }, // MP gerencia parcelamento internamente
};

function calcPublicPrice(basePrice, method, installments = 1) {
  const plat = Math.round(basePrice * PLATFORM_FEE_RATE * 100) / 100;
  let mpFee = 0;
  if (method === "PIX")         mpFee = Math.round(basePrice * MP_SERVER_RATES.PIX.pct * 100) / 100;
  if (method === "BOLETO")      mpFee = MP_SERVER_RATES.BOLETO.fixed;
  if (method === "CREDIT_CARD") mpFee = Math.round(basePrice * MP_SERVER_RATES.CC.pct * 100) / 100;
  return {
    clientTotal:  Math.round((basePrice + plat + mpFee) * 100) / 100,
    platformFee:  plat,
    asaasFee:     mpFee,
    producerGets: basePrice,
  };
}

/** GET /api/public/products/:id — retorna config do produto (sem dados sensíveis) */
app.get("/api/public/products/:id", async (req, res) => {
  try {
    const { data: product, error } = await supabase.from("products")
      .select("id,name,description,price,billing_type,subscription_cycle,upsell_url,downsell_url,obrigado_url,gtm_id")
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
      upsellUrl:        product.upsell_url   || null,
      downsellUrl:      product.downsell_url  || null,
      obrigadoUrl:      product.obrigado_url  || null,
      gtmId:            product.gtm_id        || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/public/checkout — cria customer + payment no Mercado Pago */
app.post("/api/public/checkout", async (req, res) => {
  try {
    const { productId, name, email, phone, cpfCnpj, postalCode,
            addressNumber, method, installments = 1, birthday } = req.body;
    if (!productId || !name || !email || !cpfCnpj || !method) {
      return res.status(400).json({ error: "Campos obrigatórios: productId, name, email, cpfCnpj, method" });
    }

    const { data: product } = await supabase.from("products")
      .select("id,name,description,price,billing_type,subscription_cycle,owner_id,asaas_link_id,upsell_url,obrigado_url")
      .eq("id", productId).maybeSingle();
    if (!product) return res.status(404).json({ error: "Produto não encontrado" });

    const basePrice       = Number(product.price);
    const numInstallments = method === "CREDIT_CARD" ? Math.min(12, Math.max(1, Number(installments))) : 1;
    const { clientTotal, platformFee: pfee, asaasFee, producerGets } = calcPublicPrice(basePrice, method, numInstallments);
    const isRecurrent     = product.billing_type === "RECURRENT";
    const saleId          = require("crypto").randomUUID();

    // 1. Garante customer no Supabase
    let customerId = null;
    const { data: existByEmail } = await supabase.from("customers")
      .select("id").eq("email", email).eq("owner_id", product.owner_id).maybeSingle();
    if (existByEmail) {
      customerId = existByEmail.id;
      const { data: existing } = await supabase.from("customers")
        .select("phone,birthday,cpf_cnpj,postal_code,address_number")
        .eq("id", customerId).maybeSingle();
      await supabase.from("customers").update({
        name,
        phone:          phone                          || existing?.phone          || null,
        birthday:       birthday                       || existing?.birthday       || null,
        cpf_cnpj:      (cpfCnpj?.replace(/\D/g,''))   || existing?.cpf_cnpj      || null,
        postal_code:   (postalCode?.replace(/\D/g,'')) || existing?.postal_code   || null,
        address_number: addressNumber                  || existing?.address_number || null,
      }).eq("id", customerId);
    } else {
      const { data: newCust, error: custErr } = await supabase.from("customers")
        .insert({ name, email, phone: phone || null, owner_id: product.owner_id,
          birthday: birthday || null,
          cpf_cnpj: cpfCnpj?.replace(/\D/g,'') || null,
          postal_code: postalCode?.replace(/\D/g,'') || null,
          address_number: addressNumber || null })
        .select("id").maybeSingle();
      if (custErr) {
        // Race condition: outro request pode ter inserido o mesmo email simultaneamente
        console.error("[public/checkout] ERRO insert customer:", JSON.stringify(custErr));
        const { data: retried } = await supabase.from("customers")
          .select("id").eq("email", email).eq("owner_id", product.owner_id).maybeSingle();
        customerId = retried?.id ?? null;
      } else {
        customerId = newCust?.id ?? null;
      }
      if (!customerId) {
        return res.status(500).json({ error: "Não foi possível identificar o cliente. Tente novamente." });
      }
    }

    // 2. Cria pagamento no Mercado Pago
    let chargeId = null, pixQrCode = null, pixCopyCola = null, boletoUrl = null, invoiceUrl = null;

    const nameParts  = name.trim().split(" ");
    const payer = {
      email,
      first_name: nameParts[0],
      last_name:  nameParts.slice(1).join(" ") || nameParts[0],
      identification: { type: "CPF", number: cpfCnpj.replace(/\D/g, "") },
      address: postalCode ? { zip_code: postalCode.replace(/\D/g, ""), street_number: addressNumber || "S/N" } : undefined,
    };

    const extRef = JSON.stringify({ saleId, type: isRecurrent ? "SUBSCRIPTION" : "ONE_TIME" });

    if (method === "CREDIT_CARD" || isRecurrent) {
      // Cria preference NOVA por checkout — external_reference contém saleId
      // Isso garante que o webhook encontre a sale via strategy 2 (ref.saleId) — sem ambiguidade
      console.log("[public/checkout] criando preference CC com saleId:", saleId, "extRef:", extRef);
      const prefResp = await mp.post("/checkout/preferences", {
        items: [{
          title:       product.name,
          description: product.description || product.name,
          quantity:    1,
          unit_price:  clientTotal,
          currency_id: "BRL",
        }],
        payer: { email, first_name: nameParts[0], last_name: nameParts.slice(1).join(" ") || nameParts[0] },
        external_reference: extRef,    // {"saleId": "uuid", "type": "ONE_TIME"}
        notification_url:   `${PUBLIC_URL}/api/mp/webhook`,
        payment_methods:    { installments: isRecurrent ? 1 : 12 },
        statement_descriptor: "JosephPay",
        back_urls: {
          success: product.upsell_url
            || product.obrigado_url
            || `${FRONTEND_URL}/obrigado.html?p=${productId}&amount=${clientTotal.toFixed(2)}`,
          failure: `${FRONTEND_URL}/checkout.html?p=${productId}`,
          pending: `${FRONTEND_URL}/checkout.html?p=${productId}`,
        },
        auto_return: "approved",
      });
      chargeId   = String(prefResp.data.id);
      invoiceUrl = prefResp.data.init_point || prefResp.data.sandbox_init_point;
      console.log("[public/checkout] preference criada:", chargeId, "→ invoiceUrl:", invoiceUrl?.slice(0, 60));

    } else if (method === "PIX") {
      const payResp = await mp.post("/v1/payments", {
        transaction_amount: clientTotal,
        payment_method_id:  "pix",
        payer,
        external_reference: extRef,
        description:        product.name,
        notification_url:   `${PUBLIC_URL}/api/mp/webhook`,
        installments:       1,
      });
      chargeId    = String(payResp.data.id);
      pixQrCode   = payResp.data.point_of_interaction?.transaction_data?.qr_code_base64 || null;
      pixCopyCola = payResp.data.point_of_interaction?.transaction_data?.qr_code || null;

    } else if (method === "BOLETO") {
      const payResp = await mp.post("/v1/payments", {
        transaction_amount: clientTotal,
        payment_method_id:  "bolbradesco",
        payer,
        external_reference: extRef,
        description:        product.name,
        notification_url:   `${PUBLIC_URL}/api/mp/webhook`,
        installments:       1,
        date_of_expiration: new Date(Date.now() + 3 * 86400000).toISOString(),
      });
      chargeId  = String(payResp.data.id);
      boletoUrl = payResp.data.transaction_details?.external_resource_url || null;
    }

    // 3. Salva sale pendente no Supabase
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
    if (saleErr) console.error("[public/checkout] ERRO ao criar sale:", saleErr.message);

    console.log("[public/checkout] chargeId:", chargeId, "| method:", method, "| customerId:", customerId);
    res.json({ chargeId, pixQrCode, pixCopyCola, boletoUrl, invoiceUrl, clientTotal });
  } catch (err) {
    console.error("[public/checkout] erro:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

/** GET /api/public/checkout/:chargeId/status — polling do status de pagamento */
app.get("/api/public/checkout/:chargeId/status", async (req, res) => {
  try {
    const { chargeId } = req.params;
    let status = "PENDING";
    try {
      // MP usa IDs numéricos para pagamentos diretos
      const r = await mp.get(`/v1/payments/${chargeId}`);
      const mpStatus = r.data?.status || "pending";
      // Traduz status MP → formato que o checkout.html já entende
      if (mpStatus === "approved")  status = "CONFIRMED";
      else if (mpStatus === "refunded" || mpStatus === "cancelled") status = "REFUNDED";
      else status = "PENDING";
    } catch(e) {
      // Para preference IDs (cartão/recorrente), consulta banco diretamente
      const { data: sale } = await supabase.from("sales")
        .select("status").eq("asaas_id", chargeId).maybeSingle();
      if (sale?.status === "pago") status = "CONFIRMED";
    }
    // Persiste confirmação no banco
    if (status === "CONFIRMED") {
      const { data: updatedSales } = await supabase.from("sales")
        .update({ status: "pago" })
        .eq("asaas_id", chargeId)
        .eq("status", "pendente")
        .select("owner_id, producer_amount, amount, product_id");
      const updatedSale = updatedSales?.[0];
      if (updatedSale) {
        const amountPaid = Number(updatedSale.producer_amount ?? updatedSale.amount ?? 0);
        supabase.from("products").select("title").eq("id", updatedSale.product_id).maybeSingle()
          .then(({ data: p }) => {
            sendPushToOwner(updatedSale.owner_id, {
              title: "Nova venda! 🎉",
              body:  `R$ ${amountPaid.toFixed(2).replace(".", ",")} — ${p?.title || "Produto"}`,
              url:   "/",
            });
          });
      }
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
      supabase:       !!process.env.SUPABASE_URL,
      mercadopago:    !!process.env.MP_ACCESS_TOKEN,
      chatIA:         GROQ_KEYS.length > 0 || !!process.env.ANTHROPIC_API_KEY,
      whatsapp:       !!(process.env.EVOLUTION_API_URL && !process.env.EVOLUTION_API_URL.includes("seudominio")),
      emailDisparo:   true,
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
      birthday: c.birthday?.trim() || null,
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

// Data de nascimento digitada em texto livre pelo visitante do Mini Chat (ex:
// "15/03/1990") — converte pro formato que a coluna `date` do banco aceita.
// Se não bater com nada reconhecível, retorna null em vez de quebrar o cadastro.
function parseBirthdate(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/); // DD/MM/AAAA ou DD-MM-AAAA
  if (m) {
    const [, d, mo, y] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    if (date.getFullYear() == y && date.getMonth() == mo - 1 && date.getDate() == d) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return null;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); // já em ISO
  if (m) return s;
  return null;
}

// ── CRM: entrada de lead via MiniChat (protegido por X-Owner-Key) ─────────────
const leadsRateMap = new Map();
// CORS aberto — chamado de domínios externos (sites dos produtores)
app.options("/api/leads/create", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type,X-Owner-Key");
  res.header("Access-Control-Allow-Methods", "POST");
  res.sendStatus(204);
});
app.post("/api/leads/create", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type,X-Owner-Key");
  next();
}, async (req, res) => {
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

  const { name, phone, email, birthday } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Nome obrigatório" });

  const { data, error } = await supabase
    .from("customers")
    .insert({
      owner_id: profile.id,
      name: name.trim(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      birthday: parseBirthdate(birthday),
      source: "minichat",
      status: "lead",
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  sendPushToOwner(profile.id, { title: "Novo interessado!", body: name.trim(), url: "/" });
  res.json(data);
});

// ── Mini Chat: rastreio de sessão (até qual pergunta a pessoa chegou, o que
// respondeu, se terminou) — só analytics, nunca dispara mensagem nenhuma.
// Chamado a cada pergunta respondida no minichat.html; público, mesmo padrão
// de validação leve do /api/leads/create.
const minichatTrackRateMap = new Map();
app.options("/api/minichat/track-progress", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "POST");
  res.sendStatus(204);
});
app.post("/api/minichat/track-progress", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
}, async (req, res) => {
  try {
    const { owner_id, visitor_id, index, question, answer, questions_total, completed, finished_via } = req.body;
    if (!owner_id || !visitor_id) return res.status(400).json({ error: "Dados incompletos" });

    // Rate limit: 40 req/min por visitante (um fluxo tem no máximo ~10 perguntas,
    // dá folga pra retries de rede sem abrir brecha de abuso).
    const rateKey = `${owner_id}:${visitor_id}`;
    const now = Date.now();
    const entry = minichatTrackRateMap.get(rateKey) || { count: 0, reset: now + 60000 };
    if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
    entry.count++;
    minichatTrackRateMap.set(rateKey, entry);
    if (entry.count > 40) return res.status(429).json({ error: "Limite de requisições atingido" });

    const { data: profile } = await supabase.from("profiles").select("id").eq("id", owner_id).maybeSingle();
    if (!profile) return res.status(401).json({ error: "owner_id inválido" });

    const { data: existing } = await supabase.from("minichat_sessions").select("answers").eq("owner_id", owner_id).eq("visitor_id", visitor_id).maybeSingle();
    const answers = Array.isArray(existing?.answers) ? [...existing.answers] : [];
    if (typeof index === "number" && (question || answer)) {
      answers[index] = { question: String(question || "").slice(0, 300), answer: String(answer || "").slice(0, 500) };
    }

    const row = {
      owner_id,
      visitor_id: String(visitor_id).slice(0, 100),
      questions_total: typeof questions_total === "number" ? questions_total : undefined,
      current_index: typeof index === "number" ? index : undefined,
      answers,
      updated_at: new Date().toISOString(),
    };
    if (completed) { row.completed_at = new Date().toISOString(); row.finished_via = finished_via === "email" ? "email" : "whatsapp"; }
    Object.keys(row).forEach(k => row[k] === undefined && delete row[k]);

    const { error } = await supabase.from("minichat_sessions").upsert({ ...row, owner_id, visitor_id: row.visitor_id }, { onConflict: "owner_id,visitor_id" });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    console.error("[minichat/track-progress]", err.message);
    res.status(500).json({ error: err.message });
  }
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

// ── DELETE /api/customers/:id (soft delete) ───────────────────────────────────
app.delete("/api/customers/:id", requireAuth, async (req, res) => {
  const { error } = await supabase.from("customers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("owner_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── PATCH /api/customers/:id ─────────────────────────────────────────────────
app.patch("/api/customers/:id", requireAuth, async (req, res) => {
  const allowed = ['name','phone','email','birthday','notes','postal_code','address_number'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined && req.body[k] !== null && req.body[k] !== '') updates[k] = req.body[k];
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: "Nada para atualizar" });
  if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email))
    return res.status(400).json({ error: "Email inválido" });
  if (updates.phone && !/^\d{8,15}$/.test(updates.phone.replace(/\D/g,'')))
    return res.status(400).json({ error: "Telefone inválido" });
  const { data, error } = await supabase.from("customers").update(updates)
    .eq("id", req.params.id).eq("owner_id", req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── POST /api/whatsapp/send-group ─────────────────────────────────────────────
app.post("/api/whatsapp/send-group", requireAuth, requireSubscription, async (req, res) => {
  try {
  if (!evo) return res.status(503).json({ error: "Evolution API não configurada" });
  const inst = await getUserInst(req.user.id);
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
        const r = await evo.post(`/message/sendText/${inst}`, {
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
    const inst = await getUserInst(req.user.id);
    // Logout + delete para limpar instância em modo QR, depois recria em modo pairing
    await evo.delete(`/instance/logout/${inst}`).catch(() => {});
    await evo.delete(`/instance/delete/${inst}`).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    await evo.post(`/instance/create`, { instanceName: inst, qrcode: false, integration: "WHATSAPP-BAILEYS" });
    await setupEvolutionWebhook(inst);
    await new Promise(r => setTimeout(r, 1000));
    const { data } = await evo.get(`/instance/connect/${inst}`, { params: { number: phone } });
    res.json({ pairingCode: data.pairingCode || null });
  } catch (err) {
    console.error("[pairing-code]", err.response?.data || err.message);
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
    const { user_id, domain, page, referrer, source, device, event_type, gclid } = req.body || {};
    if (!user_id) return;
    // valida que o user_id existe (evita lixo no banco)
    const { data: profile } = await supabase
      .from("profiles").select("id").eq("id", user_id).maybeSingle();
    if (!profile?.id) return;
    const normalizeSource = s => {
      if (!s) return "direto";
      const l = s.toLowerCase();
      if (["ig","insta","instagram","i.instagram.com"].includes(l) || l.includes("instagram")) return "instagram";
      if (["fb","facebook","fb.com"].includes(l) || l.includes("facebook")) return "facebook";
      if (["gg","goog","google"].includes(l) || l.includes("google")) return "google";
      if (["wa","wpp","whatsapp"].includes(l) || l.includes("whatsapp")) return "whatsapp";
      return l;
    };
    const eventType = ["click_ligar", "click_whatsapp"].includes(event_type) ? event_type : "pageview";
    await supabase.from("visits").insert({
      owner_id: user_id,
      site_url: domain  || "",
      page:     page    || "/",
      referrer: referrer|| "",
      source:   normalizeSource(source),
      device:   device  || "unknown",
      event_type: eventType,
      has_gclid: !!gclid, // gclid só existe na URL quando o clique veio de um anúncio pago do Google Ads
    }).then(null, e => console.warn("[track/visit]", e.message));
  } catch(e) { console.error("[track/visit]", e.message); }
});

// preflight CORS para o sensor
app.options("/api/track/visit", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

// ── Sensor hospedado — uma linha no <head> substitui o bloco inteiro ──────────
app.get("/sensor.js", (req, res) => {
  const uid = (req.query.uid || "").replace(/[^a-zA-Z0-9\-]/g, "");
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Content-Type", "application/javascript");
  res.header("Cache-Control", "public, max-age=3600");
  if (!uid) return res.send("/* sensor.js: uid ausente */");
  res.send(`(function(){
var JP="${PUBLIC_URL}";var uid="${uid}";
var p=window.location.pathname;var ref=document.referrer;
var q=new URLSearchParams(window.location.search);
var src=q.get("utm_source")||(ref.includes("instagram")||ref.includes("i.instagram.com")?"instagram":ref.includes("google")?"google":ref.includes("facebook")||ref.includes("fb.")?"facebook":ref.includes("whatsapp")||ref.includes("com.whatsapp")?"whatsapp":ref?"referral":"direto");
var dev=/Mobi|Android/i.test(navigator.userAgent)?"mobile":"desktop";
var gclid=q.get("gclid")?1:0;
fetch(JP+"/api/track/visit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user_id:uid,domain:window.location.hostname,page:p,referrer:ref,source:src,device:dev,gclid:gclid})}).catch(function(){});
document.addEventListener("click",function(e){
  var a=e.target&&e.target.closest?e.target.closest("a"):null;
  if(!a||!a.href)return;
  var href=a.href;var type=null;
  if(href.indexOf("tel:")===0)type="click_ligar";
  else if(href.indexOf("wa.me")>-1||href.indexOf("whatsapp.com")>-1)type="click_whatsapp";
  if(!type)return;
  fetch(JP+"/api/track/visit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user_id:uid,domain:window.location.hostname,page:p,referrer:ref,source:src,device:dev,event_type:type})}).catch(function(){});
},true);
})();`);
});

// ── Funil de conversão ────────────────────────────────────────────────────────
app.get("/api/funnel", requireAuth, async (req, res) => {
  try {
    const uid  = req.user.id;
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const [total, chatVisits, checkoutVisits, cliquesLigar, cliquesWhats, leads, salesRes, salesSrc] = await Promise.all([
      supabase.from("visits").select("*",{count:"exact",head:true}).eq("owner_id",uid).eq("event_type","pageview").gte("created_at",from),
      supabase.from("visits").select("*",{count:"exact",head:true}).eq("owner_id",uid).eq("event_type","pageview").gte("created_at",from).ilike("page","%minichat%"),
      supabase.from("visits").select("*",{count:"exact",head:true}).eq("owner_id",uid).eq("event_type","pageview").gte("created_at",from).ilike("page","%checkout%"),
      supabase.from("visits").select("*",{count:"exact",head:true}).eq("owner_id",uid).eq("event_type","click_ligar").gte("created_at",from),
      supabase.from("visits").select("*",{count:"exact",head:true}).eq("owner_id",uid).eq("event_type","click_whatsapp").gte("created_at",from),
      supabase.from("customers").select("*",{count:"exact",head:true}).eq("owner_id",uid).eq("source","minichat").gte("created_at",from).is("deleted_at",null),
      supabase.from("sales").select("*",{count:"exact",head:true}).eq("owner_id",uid).eq("status","pago").gte("created_at",from),
      supabase.from("sales").select("producer_amount,amount,customers!customer_id(source)").eq("owner_id",uid).eq("status","pago").gte("created_at",from),
    ]);
    // agrupa origem de vendas
    const srcMap = {};
    (salesSrc.data || []).forEach(s => {
      const src = s.customers?.source || "direto";
      if (!srcMap[src]) srcMap[src] = { count: 0, revenue: 0 };
      srcMap[src].count++;
      srcMap[src].revenue += Number(s.producer_amount || s.amount || 0);
    });
    const salesBySource = Object.entries(srcMap)
      .map(([source, d]) => ({ source, ...d }))
      .sort((a, b) => b.revenue - a.revenue);
    res.json({
      visitors:  total.count       || 0,
      chat:      chatVisits.count  || 0,
      leads:     leads.count       || 0,
      checkout:  checkoutVisits.count || 0,
      cliquesLigar:    cliquesLigar.count || 0,
      cliquesWhatsapp: cliquesWhats.count || 0,
      sales:     salesRes.count    || 0,
      salesBySource,
    });
  } catch(err) {
    console.error("[funnel]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Analytics: dados de visitas para a aba Máquina ───────────────────────────
app.get("/api/analytics/visits", requireAuth, async (req, res) => {
  const days  = Math.min(parseInt(req.query.days) || 30, 30);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data: rows } = await supabase
    .from("visits").select("created_at, source, device")
    .eq("owner_id", req.user.id).eq("event_type", "pageview").gte("created_at", since);
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

  const byDevice = {};
  rows.forEach(r => { byDevice[r.device||'unknown'] = (byDevice[r.device||'unknown']||0) + 1; });
  const devices = Object.entries(byDevice)
    .map(([device, cnt]) => ({ device, count: cnt, pct: total ? Math.round(cnt*100/total) : 0 }))
    .sort((a, b) => b.count - a.count);

  res.json({ total, daily, sources, devices });
});

app.get("/api/admin/analytics/visits", requireAuth, requireAdmin, async (req, res) => {
  const days  = Math.min(parseInt(req.query.days) || 30, 30);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data: rows } = await supabase.from("visits").select("source").eq("event_type", "pageview").gte("created_at", since);
  if (!rows) return res.json({ total: 0, sources: [] });
  const bySrc = {};
  rows.forEach(r => { bySrc[r.source] = (bySrc[r.source] || 0) + 1; });
  const total = rows.length;
  const sources = Object.entries(bySrc)
    .map(([src, cnt]) => ({ source: src, count: cnt, pct: total ? Math.round(cnt * 100 / total) : 0 }))
    .sort((a, b) => b.count - a.count);
  res.json({ total, sources });
});

// Mesma coisa que /api/analytics/visits (usada pelo produtor na aba Máquina), só que o admin
// escolhe de qual cliente via ?owner= — pra ver o gráfico de visitas de qualquer cliente.
app.get("/api/admin/client-analytics", requireAuth, requireAdmin, async (req, res) => {
  const owner = req.query.owner;
  if (!owner) return res.status(400).json({ error: "owner ausente" });
  const days  = Math.min(parseInt(req.query.days) || 30, 30);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data: rows } = await supabase
    .from("visits").select("created_at, source, device")
    .eq("owner_id", owner).eq("event_type", "pageview").gte("created_at", since);
  if (!rows) return res.json({ total: 0, daily: [], sources: [], devices: [] });

  const byDay = {};
  rows.forEach(r => { const d = r.created_at.slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; });
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    daily.push({ date: d, count: byDay[d] || 0 });
  }

  const bySrc = {};
  rows.forEach(r => { bySrc[r.source] = (bySrc[r.source] || 0) + 1; });
  const total = rows.length;
  const sources = Object.entries(bySrc)
    .map(([src, cnt]) => ({ source: src, count: cnt, pct: total ? Math.round(cnt * 100 / total) : 0 }))
    .sort((a, b) => b.count - a.count);

  const byDevice = {};
  rows.forEach(r => { byDevice[r.device || 'unknown'] = (byDevice[r.device || 'unknown'] || 0) + 1; });
  const devices = Object.entries(byDevice)
    .map(([device, cnt]) => ({ device, count: cnt, pct: total ? Math.round(cnt * 100 / total) : 0 }))
    .sort((a, b) => b.count - a.count);

  res.json({ total, daily, sources, devices });
});

// Mesma coisa que /api/funnel (produtor, aba Máquina), só que o admin escolhe o cliente via ?owner=.
app.get("/api/admin/funnel", requireAuth, requireAdmin, async (req, res) => {
  try {
    const uid = req.query.owner;
    if (!uid) return res.status(400).json({ error: "owner ausente" });
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const [total, chatVisits, checkoutVisits, cliquesLigar, cliquesWhats, leads, salesRes] = await Promise.all([
      supabase.from("visits").select("*", { count: "exact", head: true }).eq("owner_id", uid).eq("event_type", "pageview").gte("created_at", from),
      supabase.from("visits").select("*", { count: "exact", head: true }).eq("owner_id", uid).eq("event_type", "pageview").gte("created_at", from).ilike("page", "%minichat%"),
      supabase.from("visits").select("*", { count: "exact", head: true }).eq("owner_id", uid).eq("event_type", "pageview").gte("created_at", from).ilike("page", "%checkout%"),
      supabase.from("visits").select("*", { count: "exact", head: true }).eq("owner_id", uid).eq("event_type", "click_ligar").gte("created_at", from),
      supabase.from("visits").select("*", { count: "exact", head: true }).eq("owner_id", uid).eq("event_type", "click_whatsapp").gte("created_at", from),
      supabase.from("customers").select("*", { count: "exact", head: true }).eq("owner_id", uid).eq("source", "minichat").gte("created_at", from).is("deleted_at", null),
      supabase.from("sales").select("*", { count: "exact", head: true }).eq("owner_id", uid).eq("status", "pago").gte("created_at", from),
    ]);
    res.json({
      visitors: total.count || 0,
      chat: chatVisits.count || 0,
      leads: leads.count || 0,
      checkout: checkoutVisits.count || 0,
      cliquesLigar: cliquesLigar.count || 0,
      cliquesWhatsapp: cliquesWhats.count || 0,
      sales: salesRes.count || 0,
    });
  } catch (err) {
    console.error("[admin/funnel]", err.message);
    res.status(500).json({ error: err.message });
  }
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

// ── Avatar: upload server-side usando service role (evita policy issues) ──────
app.post("/api/user/avatar", requireAuth, async (req, res) => {
  const { base64 } = req.body;
  if (!base64) return res.status(400).json({ error: "base64 ausente" });
  const match = base64.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "formato inválido" });
  const contentType = match[1];
  const ext = contentType.split("/")[1] || "jpg";
  const buffer = Buffer.from(match[2], "base64");
  const path = `avatars/${req.user.id}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, buffer, { contentType, upsert: true });
  if (error) return res.status(500).json({ error: error.message });
  const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
  // upsert reaproveita o mesmo path, então a URL não muda entre uploads —
  // sem isso o navegador/CDN serve a imagem antiga do cache mesmo após salvar
  const url = `${publicUrl}?v=${Date.now()}`;
  await supabase.from("profiles").update({ avatar_url: url }).eq("id", req.user.id);
  res.json({ url });
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
  res.json({ ok: true });
  try {
    const payload = req.body;

    // Opção B — relay fire-and-forget para N8N (se configurado)
    if (N8N_WEBHOOK_URL) {
      fetch(N8N_WEBHOOK_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      }).catch(e => console.warn("[inbound→n8n]", e.message));
    }

    const instName = payload?.instance;
    const messages = payload?.data?.messages
      || (Array.isArray(payload?.data) ? payload.data : []);
    if (!messages.length) return;

    // Identifica o dono pela instância que gerou a mensagem
    let ownerId = null;
    if (instName) {
      const { data: prof } = await supabase.from("profiles").select("id").eq("whatsapp_instance", instName).single();
      ownerId = prof?.id;
    }
    if (!ownerId) {
      console.warn("[inbound] owner não encontrado para instância:", instName);
      return;
    }

    for (const msg of messages) {
      if (msg.key?.fromMe) continue;
      const remoteJid = msg.key?.remoteJid || "";
      if (remoteJid.endsWith("@g.us")) continue;
      const fromNumber = remoteJid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
      const content = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption || "";
      if (!content || !fromNumber) continue;
      await supabase.from("messages").insert({
        owner_id:     ownerId,
        content,
        status:       "inbound",
        group_target: "_inbound_" + fromNumber,
        group_count:  0,
      }).then(null, e => console.warn("[inbound] insert:", e.message));
      console.log(`[inbound] ${instName} / ${fromNumber}: ${content.slice(0, 60)}`);
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

async function getEvolutionVersion() {
  try {
    const { data } = await evo.get("/");
    const raw = data?.version || data?.info?.version || "";
    const major = parseInt(raw.toString().replace(/[^0-9]/, "")) || 1;
    console.log(`[evolution] versão detectada: ${raw || "desconhecida"} (major=${major})`);
    return major;
  } catch(e) {
    console.warn("[evolution] não foi possível detectar versão:", e.message);
    return 1;
  }
}

async function setupEvolutionWebhook(inst) {
  try {
    // Tenta formato v2 primeiro (wrapper "webhook" + camelCase)
    // Se a Evolution for v1 vai rejeitar e tentamos o formato v1
    let ok = false;
    try {
      await evo.post(`/webhook/set/${inst}`, {
        webhook: {
          enabled:        true,
          url:            `${PUBLIC_URL}/api/whatsapp/inbound`,
          webhookByEvents: false,
          webhookBase64:  false,
          events:         ["MESSAGES_UPSERT"],
        },
      });
      ok = true;
      console.log(`[evolution] webhook v2 configurado para ${inst}`);
    } catch {
      // v1 format
      await evo.post(`/webhook/set/${inst}`, {
        url:              `${PUBLIC_URL}/api/whatsapp/inbound`,
        webhook_by_events: false,
        webhook_base64:   false,
        events:           ["MESSAGES_UPSERT"],
      });
      console.log(`[evolution] webhook v1 configurado para ${inst}`);
    }

    // Opção A — se N8N_WEBHOOK_URL configurado, tenta registrar segundo webhook (Evolution v2)
    if (N8N_WEBHOOK_URL) {
      try {
        await evo.post(`/webhook/set/${inst}`, {
          webhook: {
            enabled:        true,
            url:            `${PUBLIC_URL}/api/whatsapp/inbound`,
            webhookByEvents: false,
            webhookBase64:  false,
            events:         ["MESSAGES_UPSERT"],
          },
          // Alguns builds Evolution v2 aceitam webhooks adicionais nesta chave
          additionalWebhooks: [{ url: N8N_WEBHOOK_URL, events: ["MESSAGES_UPSERT"] }],
        });
        console.log(`[evolution] webhook adicional N8N configurado para ${inst} (Opção A)`);
      } catch {
        console.log(`[evolution] Evolution não suporta webhook adicional nativo — Opção B (relay) ativa para ${inst}`);
      }
    }
  } catch(e) { console.warn(`[evolution] webhook setup ${inst}:`, e.message); }
}

async function ensureBuckets() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const names = (buckets || []).map(b => b.name);
  if (!names.includes("avatars")) {
    await supabase.storage.createBucket("avatars", { public: true });
    console.log("   Storage: bucket 'avatars' criado");
  }
}

app.listen(PORT, () => {
  console.log(`\n🚀 JosephPay API rodando na porta ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
  ensureBuckets();
  syncAssinanteStatus();
  if (evo) {
    getEvolutionVersion().then(() => {
      if (N8N_WEBHOOK_URL) console.log(`   N8N relay ativo → ${N8N_WEBHOOK_URL}`);
      supabase.from("profiles").select("whatsapp_instance").not("whatsapp_instance", "is", null)
        .then(({ data }) => {
          (data || []).forEach(p => p.whatsapp_instance && setupEvolutionWebhook(p.whatsapp_instance));
        });
    });
  }
});
