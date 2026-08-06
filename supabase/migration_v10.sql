-- migration_v10.sql — funil pós-compra (upsell / downsell) por produto
-- Rodar no Supabase SQL Editor

ALTER TABLE products ADD COLUMN IF NOT EXISTS upsell_url  text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS downsell_url text;
