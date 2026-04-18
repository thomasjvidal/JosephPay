-- migration_v6: adiciona billing_type e subscription_cycle na tabela products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'UNDEFINED',
  ADD COLUMN IF NOT EXISTS subscription_cycle TEXT;
