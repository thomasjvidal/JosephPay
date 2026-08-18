-- ═══════════════════════════════════════════════════════════════════
--  migration_v28 — Módulo Google Ads no Admin: cada produtor pode ter
--  uma conta de Google Ads (customer id) vinculada, pra correlacionar
--  gasto/campanhas de anúncio com os dados que o JosephPay já rastreia
--  (visitas, interessados, clientes, vendas) daquele produtor.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS google_ads_customer_id text;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT name, google_ads_customer_id FROM profiles WHERE google_ads_customer_id IS NOT NULL;
