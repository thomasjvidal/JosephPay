-- migration_v11.sql — página de obrigado por produto
-- Rodar no Supabase SQL Editor

ALTER TABLE products ADD COLUMN IF NOT EXISTS obrigado_url text;
