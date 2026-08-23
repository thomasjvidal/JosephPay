-- ═══════════════════════════════════════════════════════════════════
--  migration_v33 — Notificações push (celular) pros produtores: novo
--  interessado no CRM e nova venda paga. Guarda a "inscrição" que o
--  navegador de cada produtor cria ao ativar notificações (endpoint +
--  chaves de criptografia do Web Push), pra o servidor conseguir
--  mandar avisos mesmo com o app fechado.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_owner ON push_subscriptions(owner_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
-- Sem policies pra anon/authenticated — o backend (service role) grava a inscrição
-- quando o próprio produtor ativa notificações no navegador dele, e é o único que
-- lê essa tabela pra mandar os avisos. Mesmo padrão de trava das outras tabelas
-- sensíveis (producer_notes, minichat_sessions, login_events).

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT owner_id, count(*) FROM push_subscriptions GROUP BY owner_id;
