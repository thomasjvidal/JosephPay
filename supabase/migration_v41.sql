-- v41: nome de quem visualizou o relatório público
-- Só marcar "visualizado" não bastava pro Thomas ("consigo ver se a pessoa viu") — ele
-- quer saber QUEM viu, não só que alguém abriu o link. relatorio.html agora pede o nome
-- antes de mostrar o relatório e manda junto na hora de marcar a visualização.

ALTER TABLE google_ads_reports
  ADD COLUMN IF NOT EXISTS viewed_by text;
