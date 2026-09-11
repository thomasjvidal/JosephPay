-- v37: snapshots manuais de investimento do Google Ads
-- Enquanto a integração real do Google Ads não estiver conectada (ou não for a
-- prioridade agora), o admin cola no ChatGPT capturas de tela do app do Google Ads,
-- pede pra extrair os números e cola a resposta JSON aqui no sistema. Cada snapshot
-- é histórico (nunca sobrescreve o anterior) pra permitir comparar com "a última vez
-- que fiz análise", igual ao "+X% vs período anterior" que já existe pros outros
-- números do painel.

CREATE TABLE IF NOT EXISTS google_ads_manual_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES profiles(id),
  periodo_dias int NOT NULL,
  investimento_total numeric NOT NULL,
  campanhas jsonb NOT NULL DEFAULT '[]',
  raw_gpt_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_ads_manual_snapshots_owner_periodo_idx
  ON google_ads_manual_snapshots (owner_id, periodo_dias, created_at DESC);

-- Só o backend (service role) lê/escreve — mesmo padrão de producer_notes/login_events.
ALTER TABLE google_ads_manual_snapshots ENABLE ROW LEVEL SECURITY;
