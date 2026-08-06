-- migration_v12.sql — rastreamento GTM por produto
-- Rodar no Supabase SQL Editor

ALTER TABLE products ADD COLUMN IF NOT EXISTS gtm_id text;
