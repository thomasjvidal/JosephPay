-- ═══════════════════════════════════════════════════════════════════
--  migration_v24 — Detecção real de Google Ads (via gclid)
--  Quando um clique vem de um anúncio pago do Google, a URL sempre traz
--  um parâmetro "gclid" (Google Click ID) — é assim que o próprio Google
--  identifica cliques pagos. Não existe isso em tráfego orgânico. Então,
--  em vez de o admin "adivinhar" ou marcar manualmente se um cliente usa
--  Google Ads, o sensor já instalado detecta sozinho.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS has_gclid boolean NOT NULL DEFAULT false;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT owner_id, count(*) FROM visits WHERE has_gclid = true GROUP BY owner_id;
