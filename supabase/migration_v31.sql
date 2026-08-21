-- ═══════════════════════════════════════════════════════════════════
--  migration_v31 — Rastreio de sessões do Mini Chat: até qual pergunta
--  cada visitante chegou, o que respondeu em cada uma, e se terminou o
--  fluxo (e por qual canal). Usado pro Admin ver o funil de cada
--  cliente (onde as pessoas desistem) e as respostas individuais.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS minichat_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  visitor_id      text NOT NULL,
  questions_total int,
  current_index   int NOT NULL DEFAULT 0,
  answers         jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at    timestamptz,
  finished_via    text, -- 'whatsapp' | 'email' | null
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, visitor_id)
);

CREATE INDEX IF NOT EXISTS idx_minichat_sessions_owner ON minichat_sessions(owner_id);

ALTER TABLE minichat_sessions ENABLE ROW LEVEL SECURITY;
-- Sem policies pra anon/authenticated — o minichat.html grava via endpoint público
-- do backend (que valida o owner_id), e o Admin lê via service role. Mesmo padrão
-- de trava usado em producer_notes (migration_v27) e login_events (migration_v25).

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT owner_id, count(*), count(completed_at) FROM minichat_sessions GROUP BY owner_id;
