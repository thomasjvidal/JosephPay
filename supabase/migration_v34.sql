-- v34: campo disabled_at na tabela profiles
-- Permite desativar um cliente sem excluí-lo.
-- NULL = ativo  |  timestamp preenchido = inativo

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz DEFAULT NULL;
