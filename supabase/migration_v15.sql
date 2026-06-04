-- Adiciona coluna stape_user_id na tabela tracking.begin_checkout
ALTER TABLE tracking.begin_checkout
  ADD COLUMN IF NOT EXISTS stape_user_id varchar(255);
