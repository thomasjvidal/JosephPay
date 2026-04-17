-- ═══════════════════════════════════════════════════════════
--  JosephPay — Migração v2
--  Execute no SQL Editor do painel Supabase
--  (Settings → SQL Editor → New query → cole e execute)
-- ═══════════════════════════════════════════════════════════

-- ─── PRODUCTS: colunas novas para integração Asaas ──────────
alter table products
  add column if not exists asaas_price   numeric(12,2),
  add column if not exists asaas_link_id text;

-- ─── SALES: colunas de divisão de receita (ledger interno) ──
alter table sales
  add column if not exists platform_fee    numeric(12,2) default 0,
  add column if not exists producer_amount numeric(12,2);

-- Recalcula producer_amount para vendas existentes sem esse valor
update sales
set
  platform_fee    = round(amount * 0.0099, 2),
  producer_amount = round(amount - (amount * 0.0099), 2)
where producer_amount is null and status = 'pago';

-- ─── WITHDRAWALS: campo pix_key_type ────────────────────────
alter table withdrawals
  add column if not exists pix_key_type text default 'CPF';

-- ─── PROFILES: campo email (útil para admin ver email) ───────
alter table profiles
  add column if not exists email text;

-- Sincroniza email do Auth para profiles (se quiser)
-- update profiles p set email = u.email
-- from auth.users u where u.id = p.id and p.email is null;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- Após executar, rode estas queries para confirmar:
-- select column_name from information_schema.columns where table_name = 'products';
-- select column_name from information_schema.columns where table_name = 'sales';
