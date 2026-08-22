-- ═══════════════════════════════════════════════════════════════════
--  migration_v32 — Marca quando o repositório do cliente foi preparado
--  pra importar direto na Vercel (vercel.json com build/rewrite certos).
--  Evita ter que pedir pra outra IA preparar o repositório toda vez
--  antes de importar na Vercel.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS github_vercel_ready_at timestamptz;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT name, github_repo, github_vercel_ready_at FROM profiles WHERE github_vercel_ready_at IS NOT NULL;
