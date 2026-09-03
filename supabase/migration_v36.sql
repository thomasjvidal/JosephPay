-- v36: campos de verificação real do Mini Chat na tabela profiles
-- Guarda o resultado da última checagem ao vivo (verifyMinichatLive) — usado pra o
-- card do produtor na lista de Clientes mostrar a MESMA verdade que aparece dentro do
-- perfil dele, em vez de um sinal fraco (qualquer visita histórica numa página com
-- "minichat" no nome, que ficava verde pra sempre mesmo com o Mini Chat quebrado).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS github_minichat_verified_ok boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS github_minichat_verified_at timestamptz DEFAULT NULL;
