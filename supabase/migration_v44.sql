-- v44: métricas do Mini Chat (sub-aba "📊 Mini Chat" do produtor).
-- Tudo opcional e só ADICIONA colunas — nada existente muda. Antes de rodar, o Admin
-- já mostra as métricas; depois de rodar passa a separar Google Ads x orgânico e a
-- ligar cada conversa ao contato do CRM (lista de interessados quentes + aviso 🔥).
-- Seguro rodar mais de uma vez.

ALTER TABLE minichat_sessions ADD COLUMN IF NOT EXISTS origem text;        -- google_ads | google | instagram | facebook | whatsapp | site | direto | outro
ALTER TABLE minichat_sessions ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE minichat_sessions ADD COLUMN IF NOT EXISTS quente boolean;      -- respondeu algo como "Quanto antes" / "Este mês"

CREATE INDEX IF NOT EXISTS idx_minichat_sessions_owner_created ON minichat_sessions(owner_id, created_at);

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT origem, count(*) FROM minichat_sessions GROUP BY origem;
