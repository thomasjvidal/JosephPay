-- ═══════════════════════════════════════════════════════════════════
--  migration_v19 — Atividade de login (último acesso + dias ativos/mês)
--  Toda requisição autenticada marca "hoje" como um dia ativo pra esse
--  usuário (upsert idempotente, não duplica linha no mesmo dia) e
--  atualiza profiles.last_login_at. Isso permite ao admin ver quando
--  cada produtor/afiliado entrou pela última vez e quantos dias ele
--  usou a plataforma no mês.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE TABLE IF NOT EXISTS login_events (
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day        date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT user_id, count(*) FROM login_events
--   WHERE day >= date_trunc('month', now()) GROUP BY user_id;
