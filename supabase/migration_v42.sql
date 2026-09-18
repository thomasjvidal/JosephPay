-- v42: registra TODAS as pessoas que viram o relatório, não só a última
-- google_ads_reports.viewed_by guardava um texto só — cada visualização nova
-- SOBRESCREVIA o nome anterior, então só o último visitante aparecia (Thomas notou:
-- duas pessoas comentaram, as duas tinham visto, mas só uma aparecia como "visto por").
-- Essa tabela nova guarda uma linha por pessoa (nome) que já visualizou aquele
-- relatório, com quantas vezes e quando foi a primeira/última vez — mesmo padrão de
-- dedup por nome já usado pra "veio Nx" em customers (times_seen), em vez de duplicar
-- uma linha a cada view.

CREATE TABLE IF NOT EXISTS google_ads_report_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES google_ads_reports(id) ON DELETE CASCADE,
  nome text NOT NULL,
  times_seen int NOT NULL DEFAULT 1,
  first_viewed_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE google_ads_report_views ENABLE ROW LEVEL SECURITY;
