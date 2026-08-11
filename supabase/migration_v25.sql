-- ═══════════════════════════════════════════════════════════════════
--  migration_v25 — Fecha tabelas que ficaram sem RLS (Row-Level Security)
--  login_events e platform_ledger foram criadas sem "enable row level
--  security" — sem isso, qualquer pessoa com a URL do projeto e a chave
--  anon (que fica embutida no frontend, é pública por design) consegue
--  ler/editar/apagar essas tabelas direto, sem passar pelo backend.
--  Nenhuma delas precisa de acesso via anon/authenticated — só o backend
--  (service role) lê e escreve nelas — então habilitar RLS sem nenhuma
--  policy pra anon/authenticated já resolve, sem quebrar nada.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE login_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_ledger ENABLE ROW LEVEL SECURITY;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=false;
-- (não deve mais listar login_events nem platform_ledger)
