-- ═══════════════════════════════════════════════════════════════════
--  migration_v18 — Mini Chat multi-cliente
--  Cada produtor passa a ter sua própria configuração do widget Mini Chat
--  (número de WhatsApp, nome da marca, nome usado na saudação), lida
--  dinamicamente via GET /api/minichat/config?uid= em vez de hardcoded
--  no repositório do Mini Chat.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS minichat_config jsonb;
-- Formato: {"whatsapp_number": "5524999999999", "brand_name": "Nexy", "greeting_name": "Nexy"}

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT id, minichat_config FROM profiles WHERE minichat_config IS NOT NULL;
