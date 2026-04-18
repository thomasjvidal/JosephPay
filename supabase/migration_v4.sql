-- ═══════════════════════════════════════════════════════════
--  JosephPay — Migração v4
--  Execute no SQL Editor do painel Supabase
--  Settings → SQL Editor → New query → cole e execute
-- ═══════════════════════════════════════════════════════════

-- Índice único em subscriptions.asaas_id para evitar duplicatas
-- (necessário para upsert por asaas_id funcionar corretamente)
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_asaas_id_idx
  ON subscriptions(asaas_id)
  WHERE asaas_id IS NOT NULL;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT indexname FROM pg_indexes WHERE tablename = 'subscriptions';
