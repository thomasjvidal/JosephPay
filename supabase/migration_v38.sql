-- v38: campos extras no snapshot manual do Google Ads
-- O Thomas quer colar, de uma vez, TUDO que o app do Google Ads mostra pra ele no
-- celular (impressões, cliques, o detalhamento de "ações locais" — visita à loja,
-- chamada, rota, etc. — e os termos de pesquisa com custo), não só o investimento
-- total. Extrai isso de várias capturas de tela via um prompt de IA (ChatGPT, fora do
-- Admin) que devolve um JSON só — esses campos guardam esse JSON maior.

ALTER TABLE google_ads_manual_snapshots
  ADD COLUMN IF NOT EXISTS impressoes int,
  ADD COLUMN IF NOT EXISTS cliques int,
  ADD COLUMN IF NOT EXISTS acoes_locais jsonb,
  ADD COLUMN IF NOT EXISTS termos_pesquisa jsonb NOT NULL DEFAULT '[]';
