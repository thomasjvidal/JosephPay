-- v40: relatórios do Google Ads salvos + link público pra compartilhar
-- Thomas quer poder gerar o relatório, ele ficar salvo (histórico por mês/ano),
-- compartilhar um link público (o produtor abre sem logar no sistema, vê só o
-- relatório) e saber se o produtor viu / deixar comentário.

CREATE TABLE IF NOT EXISTS google_ads_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES profiles(id),
  tipo text NOT NULL,
  ano int NOT NULL,
  mes int NOT NULL,
  periodo_from timestamptz NOT NULL,
  periodo_to timestamptz NOT NULL,
  dados jsonb NOT NULL,
  share_token text NOT NULL UNIQUE,
  viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Mesmo mês+tipo sempre atualiza a mesma linha (nunca duplica no histórico) — gerar de
-- novo o relatório de agosto substitui o de agosto, mantendo o mesmo link já
-- compartilhado com o produtor.
CREATE UNIQUE INDEX IF NOT EXISTS google_ads_reports_owner_tipo_periodo_idx
  ON google_ads_reports (owner_id, tipo, ano, mes);

CREATE TABLE IF NOT EXISTS google_ads_report_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES google_ads_reports(id) ON DELETE CASCADE,
  autor text,
  texto text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Só o backend (service role) lê/escreve — o acesso "público" passa pelas rotas do
-- Express (token), nunca direto no Supabase.
ALTER TABLE google_ads_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_report_comments ENABLE ROW LEVEL SECURITY;
