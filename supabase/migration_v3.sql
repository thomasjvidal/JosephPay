-- ═══════════════════════════════════════════════════════════
--  JosephPay — Migração v3
--  Execute no SQL Editor do painel Supabase
--  Settings → SQL Editor → New query → cole e execute
-- ═══════════════════════════════════════════════════════════

-- ─── SALES: colunas financeiras completas ───────────────────
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS gross_amount     numeric(12,2),  -- valor total pago pelo cliente (inclui taxa 0.99%)
  ADD COLUMN IF NOT EXISTS net_amount       numeric(12,2),  -- após taxa do gateway Asaas
  ADD COLUMN IF NOT EXISTS asaas_fee        numeric(12,2),  -- taxa cobrada pelo Asaas
  ADD COLUMN IF NOT EXISTS installment_count int DEFAULT 1, -- número de parcelas (1 = à vista)
  ADD COLUMN IF NOT EXISTS billing_type     text,           -- PIX, CREDIT_CARD, BOLETO
  ADD COLUMN IF NOT EXISTS payment_date     timestamptz;    -- data real do pagamento (confirmedDate do Asaas)

-- Preenche gross_amount para vendas existentes sem esse campo
UPDATE sales
SET gross_amount = amount
WHERE gross_amount IS NULL;

-- ─── CUSTOMERS: campo de deduplicação por ID do Asaas ────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS asaas_customer_id text;

-- Índice único para evitar duplicar clientes do mesmo Asaas ID
CREATE UNIQUE INDEX IF NOT EXISTS customers_asaas_id_idx
  ON customers(asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- Após executar, rode estas queries para confirmar:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'sales' ORDER BY column_name;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'customers' ORDER BY column_name;
