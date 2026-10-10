-- v47: contas extras do GitHub (uma por dono de repositório).
-- Pra site de cliente que está no GitHub/Vercel de OUTRA conta (ex: WeNovarks): o
-- JosephPay grava no repositório usando o token da conta dona, e aí o commit sai com
-- o autor certo — a Vercel (plano Hobby) para de bloquear a publicação.
-- A conexão principal (platform_github_auth, id = 1) continua igual.
-- Só ADICIONA uma tabela nova — nada existente muda. Seguro rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS github_extra_tokens (
  owner         text PRIMARY KEY,          -- dono dos repositórios, em minúsculas (ex: "wenovarks")
  access_token  text NOT NULL,             -- token da conta dona (nunca vai pro navegador)
  token_login   text,                      -- conta do GitHub dona do token
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE github_extra_tokens ENABLE ROW LEVEL SECURITY;
-- Sem policies: só o servidor (service role) lê e grava, igual platform_github_auth.

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT owner, token_login, updated_at FROM github_extra_tokens;
