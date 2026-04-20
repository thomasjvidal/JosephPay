-- migration_v9.sql — disparos por usuário
-- Rodar no Supabase SQL Editor

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disparos jsonb;
