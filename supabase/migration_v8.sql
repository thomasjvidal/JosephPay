-- migration_v8.sql — Tabela messages com suporte a disparos em grupo
-- Rodar no Supabase SQL Editor

-- Adiciona colunas novas se messages já existir (idempotente)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS customer_id   uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS type          text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS group_target  text,
  ADD COLUMN IF NOT EXISTS group_count   int,
  ADD COLUMN IF NOT EXISTS provider_id   text,
  ADD COLUMN IF NOT EXISTS error_message text;

-- Cria a tabela caso não exista (cenário fresh install)
CREATE TABLE IF NOT EXISTS messages (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  customer_id    uuid REFERENCES customers(id) ON DELETE SET NULL,
  direction      text NOT NULL DEFAULT 'outbound',
  content        text NOT NULL DEFAULT '',
  type           text NOT NULL DEFAULT 'text',
  group_target   text,
  group_count    int,
  status         text NOT NULL DEFAULT 'sent',
  error_message  text,
  provider_id    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS: produtor vê apenas suas mensagens
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_owner ON messages;
CREATE POLICY messages_owner ON messages
  USING (auth.uid() = owner_id);

-- Índice para leitura por produtor ordenada por data
CREATE INDEX IF NOT EXISTS messages_owner_created ON messages (owner_id, created_at DESC);
