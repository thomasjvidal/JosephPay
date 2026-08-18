-- ═══════════════════════════════════════════════════════════════════
--  migration_v29 — Developer Token do Google Ads guardado no banco em
--  vez de exigir variável de ambiente no Railway (mais fácil pro admin
--  configurar direto pela tela de Integração, sem mexer em infra).
--  Continua sendo um valor único pra plataforma inteira (não por
--  cliente) — mesma linha de platform_google_auth (id=1).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE platform_google_auth ADD COLUMN IF NOT EXISTS developer_token text;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT developer_token IS NOT NULL AS configurado FROM platform_google_auth WHERE id = 1;
