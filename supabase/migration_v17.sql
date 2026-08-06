-- ═══════════════════════════════════════════════════════════════════
--  migration_v17 — Disparo por e-mail (conexão SMTP própria do produtor)
--  Espelha o mesmo padrão do whatsapp_instance: cada produtor conecta
--  sua própria conta de e-mail (SMTP / senha de app) para os disparos
--  do CRM. Não afeta o Resend transacional (confirmação de compra).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_smtp_host  text,
  ADD COLUMN IF NOT EXISTS email_smtp_port  int,
  ADD COLUMN IF NOT EXISTS email_smtp_user  text,
  ADD COLUMN IF NOT EXISTS email_smtp_pass  text,
  ADD COLUMN IF NOT EXISTS email_from_name  text,
  ADD COLUMN IF NOT EXISTS email_connected  boolean NOT NULL DEFAULT false;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' ORDER BY column_name;
