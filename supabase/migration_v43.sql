-- v43: recupera visualizações que aconteceram ANTES da tabela google_ads_report_views
-- existir (sob o sistema antigo, que só guardava o último nome em
-- google_ads_reports.viewed_by/viewed_at) — sem isso, relatório visto 3 vezes antes de
-- hoje aparece com "0 visualizações" mesmo tendo dado real guardado.
-- Script de dados (não de schema) — seguro rodar mais de uma vez, nunca duplica
-- (cada INSERT só roda pra quem ainda não tem linha nessa tabela).

-- 1) o último "viewed_by" salvo antes da tabela nova existir.
INSERT INTO google_ads_report_views (report_id, nome, times_seen, first_viewed_at, last_viewed_at)
SELECT r.id, r.viewed_by, 1, r.viewed_at, r.viewed_at
FROM google_ads_reports r
WHERE r.viewed_by IS NOT NULL AND r.viewed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM google_ads_report_views v
    WHERE v.report_id = r.id AND lower(v.nome) = lower(r.viewed_by)
  );

-- 2) quem comentou também tinha visto (o portão de nome do relatório.html é
--    obrigatório antes de mostrar o relatório) — usa a data do comentário como
--    aproximação de quando viu, já que a visualização em si não foi registrada.
INSERT INTO google_ads_report_views (report_id, nome, times_seen, first_viewed_at, last_viewed_at)
SELECT DISTINCT c.report_id, c.autor, 1, c.created_at, c.created_at
FROM google_ads_report_comments c
WHERE c.autor IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM google_ads_report_views v
    WHERE v.report_id = c.report_id AND lower(v.nome) = lower(c.autor)
  );
