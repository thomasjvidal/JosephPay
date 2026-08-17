-- ═══════════════════════════════════════════════════════════════════
--  migration_v27 — Notas privadas do Admin sobre cada produtor (CRM do
--  Thomas). Não pode ficar em profiles: o próprio produtor lê a própria
--  linha de profiles (policy "auth.uid() = id"), então uma nota privada
--  do admin sobre aquele produtor vazaria pra ele. Tabela própria, com
--  RLS ligada e sem nenhuma policy pra anon/authenticated — só o backend
--  (service role) lê e escreve, mesmo padrão de trava do migration_v25.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS producer_notes (
  producer_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE producer_notes ENABLE ROW LEVEL SECURITY;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT tablename FROM pg_tables WHERE tablename='producer_notes' AND rowsecurity=true;
-- (deve retornar 1 linha — RLS ligada, sem policies pra anon/authenticated)
