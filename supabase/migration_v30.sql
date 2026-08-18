-- ═══════════════════════════════════════════════════════════════════
--  migration_v30 — ID da conta de gerente (MCC) do Google Ads, guardado
--  junto com o resto da conexão Google (um valor só pra plataforma
--  inteira). Necessário pra acessar as contas de Ads dos clientes
--  através da conta de gerente (header login-customer-id da API).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE platform_google_auth ADD COLUMN IF NOT EXISTS manager_customer_id text;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT manager_customer_id FROM platform_google_auth WHERE id = 1;
