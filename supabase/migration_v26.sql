-- ═══════════════════════════════════════════════════════════════════
--  migration_v26 — Instalar a "porta de entrada" do Mini Chat no
--  repositório do cliente (Opção A: arquivo leve que abre o Mini Chat
--  central do JosephPay — atualizações futuras chegam pra todos
--  automaticamente, sem precisar reinstalar nada por cliente).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS github_minichat_path text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS github_minichat_installed_at timestamptz;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT name, github_minichat_path, github_minichat_installed_at FROM profiles WHERE github_minichat_path IS NOT NULL;
