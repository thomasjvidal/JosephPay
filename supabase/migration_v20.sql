-- ═══════════════════════════════════════════════════════════════════
--  migration_v20 — Ledger da plataforma (saldo geral do Admin)
--  Registra entradas de receita que não são "venda de produto":
--  mensalidade paga pelo produtor pra usar o JosephPay, e valor de
--  ativação cobrado manualmente pelo admin ao cadastrar um cliente.
--  Taxas sobre vendas (platform_fee) já existem na tabela sales e
--  continuam sendo somadas a partir de lá, sem duplicar aqui.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_ledger (
  id                 uuid primary key default uuid_generate_v4(),
  type               text not null check (type in ('mensalidade','ativacao')),
  amount             numeric(12,2) not null,
  description        text,
  related_profile_id uuid references profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT type, sum(amount) FROM platform_ledger GROUP BY type;
