-- ═══════════════════════════════════════════════════════════
--  JosephPay — Migração v7
--  Execute no SQL Editor do painel Supabase
-- ═══════════════════════════════════════════════════════════

-- ─── CUSTOMERS: campos de CRM completo ───────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS cpf_cnpj       text,
  ADD COLUMN IF NOT EXISTS postal_code    text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS source         text NOT NULL DEFAULT 'checkout',
  ADD COLUMN IF NOT EXISTS status         text NOT NULL DEFAULT 'cliente';
-- source: 'checkout' | 'minichat' | 'manual'
-- status: 'lead' | 'cliente' | 'assinante'

-- Atualiza clientes existentes (sem source/status definido) com defaults
UPDATE customers SET source = 'checkout' WHERE source IS NULL;
UPDATE customers SET status = 'cliente'  WHERE status IS NULL;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'customers' ORDER BY column_name;
