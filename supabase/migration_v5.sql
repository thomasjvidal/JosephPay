-- ═══════════════════════════════════════════════════════════
--  JosephPay — Migração v5
--  Execute no SQL Editor do painel Supabase
--  Settings → SQL Editor → New query → cole e execute
-- ═══════════════════════════════════════════════════════════

-- ─── CUSTOMERS: campos de LTV (Life Time Value) ──────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS total_spent   numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_orders  int           DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_purchase timestamptz;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'customers' ORDER BY column_name;
