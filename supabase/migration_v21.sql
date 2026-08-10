-- ═══════════════════════════════════════════════════════════════════
--  migration_v21 — Cliques de contato (Ligar / WhatsApp) pelo sensor
--  O sensor já registra visitas na tabela visits. Agora ele também
--  registra quando o visitante clica num link "tel:" (ligar) ou de
--  WhatsApp direto no site — sem precisar de nenhuma conexão nova,
--  é o mesmo script que já está instalado.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'pageview';
-- Valores: 'pageview' (padrão, já existente) | 'click_ligar' | 'click_whatsapp'

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT event_type, count(*) FROM visits GROUP BY event_type;
