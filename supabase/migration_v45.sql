-- v45: aviso pro xPosts (app de gestão de tráfego) quando o Mini Chat capta um contato.
-- O servidor do JosephPay avisa o xPosts na hora; se o xPosts não responder 200, o
-- aviso fica guardado aqui e é reenviado sozinho mais tarde (a cada 5 min, com espera
-- crescente). Só ADICIONA uma tabela nova — nada existente muda. Seguro rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS xposts_avisos (
  id          text PRIMARY KEY,               -- = id do contato no JosephPay (customers.id)
  owner_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  payload     jsonb NOT NULL,                 -- o corpo exato enviado ao xPosts
  tentativas  int NOT NULL DEFAULT 0,
  enviado_em  timestamptz,                    -- null = ainda não entregue
  proximo_em  timestamptz NOT NULL DEFAULT now(),
  ultimo_erro text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xposts_avisos_pendentes ON xposts_avisos(proximo_em) WHERE enviado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_xposts_avisos_owner ON xposts_avisos(owner_id);

ALTER TABLE xposts_avisos ENABLE ROW LEVEL SECURITY;
-- Sem policies: só o servidor (service role) lê e grava, igual minichat_sessions.

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT owner_id, count(*) FILTER (WHERE enviado_em IS NOT NULL) AS enviados, count(*) FILTER (WHERE enviado_em IS NULL) AS pendentes FROM xposts_avisos GROUP BY owner_id;
