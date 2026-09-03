-- v35: campo github_vercel_config_sha na tabela profiles
-- Guarda o sha do vercel.json que a JosephPay escreveu por último num repositório
-- de cliente. Se o arquivo no GitHub tiver um sha diferente (alguém customizou por
-- fora), a JosephPay nunca mais sobrescreve sozinha — foi assim que um vercel.json
-- customizado pra TanStack Start virou um vercel.json genérico de Vite e quebrou o
-- deploy publicado da Lervet.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS github_vercel_config_sha text DEFAULT NULL;
