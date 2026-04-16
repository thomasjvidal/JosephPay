-- ═══════════════════════════════════════════════════════════
--  JosephPay — Supabase Schema
--  Execute no SQL Editor do seu projeto Supabase
-- ═══════════════════════════════════════════════════════════

-- Extensões necessárias
create extension if not exists "uuid-ossp";

-- ─── PROFILES ───────────────────────────────────────────────
-- Um perfil por usuário autenticado (criado automaticamente no signup)
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  role        text not null default 'client'  check (role in ('admin','client','afiliado')),
  avatar_url  text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- Cria perfil automaticamente ao novo cadastro
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'role', 'client')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─── PRODUCTS ───────────────────────────────────────────────
create table if not exists products (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  name        text not null,
  description text,
  url         text,
  price       numeric(12,2) not null default 0,
  type        text not null default 'proprio' check (type in ('proprio','coproducao')),
  status      text not null default 'ativo' check (status in ('ativo','inativo','rascunho')),
  created_at  timestamptz not null default now()
);

-- ─── CUSTOMERS ──────────────────────────────────────────────
create table if not exists customers (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  birthday    date,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ─── SALES ──────────────────────────────────────────────────
create table if not exists sales (
  id           uuid primary key default uuid_generate_v4(),
  product_id   uuid not null references products(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  owner_id     uuid not null references profiles(id) on delete cascade,
  amount       numeric(12,2) not null,
  status       text not null default 'pago' check (status in ('pago','pendente','estornado','cancelado')),
  asaas_id     text,   -- ID da cobrança no Asaas
  created_at   timestamptz not null default now()
);

-- ─── SUBSCRIPTIONS ──────────────────────────────────────────
create table if not exists subscriptions (
  id           uuid primary key default uuid_generate_v4(),
  product_id   uuid not null references products(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  owner_id     uuid not null references profiles(id) on delete cascade,
  plan         text not null default 'mensal' check (plan in ('mensal','trimestral','semestral','anual')),
  amount       numeric(12,2) not null,
  status       text not null default 'ativo' check (status in ('ativo','cancelado','pausado')),
  asaas_id     text,
  next_billing timestamptz,
  created_at   timestamptz not null default now()
);

-- ─── AFFILIATES ─────────────────────────────────────────────
create table if not exists affiliates (
  id              uuid primary key default uuid_generate_v4(),
  product_id      uuid not null references products(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  commission_rate numeric(5,2) not null default 30.00,  -- percentual
  sales_count     int not null default 0,
  total_earned    numeric(12,2) not null default 0,
  status          text not null default 'ativo' check (status in ('ativo','inativo','pendente')),
  created_at      timestamptz not null default now(),
  unique(product_id, user_id)
);

-- ─── COPRODUCERS ────────────────────────────────────────────
create table if not exists coproducers (
  id              uuid primary key default uuid_generate_v4(),
  product_id      uuid not null references products(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  split_percent   numeric(5,2) not null default 50.00,
  status          text not null default 'pendente' check (status in ('ativo','pendente','recusado')),
  created_at      timestamptz not null default now(),
  unique(product_id, user_id)
);

-- ─── MESSAGES (WhatsApp/Chat) ────────────────────────────────
create table if not exists messages (
  id           uuid primary key default uuid_generate_v4(),
  owner_id     uuid not null references profiles(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  channel      text not null default 'whatsapp' check (channel in ('whatsapp','email','chat')),
  direction    text not null default 'outbound' check (direction in ('inbound','outbound')),
  content      text not null,
  status       text not null default 'sent' check (status in ('sent','delivered','read','failed')),
  created_at   timestamptz not null default now()
);

-- ─── WITHDRAWALS ────────────────────────────────────────────
create table if not exists withdrawals (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  amount      numeric(12,2) not null,
  status      text not null default 'pendente' check (status in ('pendente','processando','concluido','falhou')),
  asaas_id    text,
  pix_key     text,
  created_at  timestamptz not null default now()
);

-- ─── VIEWS ÚTEIS ────────────────────────────────────────────

-- Receita do mês por produto
create or replace view v_product_revenue_month as
select
  product_id,
  sum(amount) as receita_mes,
  count(*) as vendas_mes
from sales
where
  status = 'pago'
  and date_trunc('month', created_at) = date_trunc('month', now())
group by product_id;

-- KPIs gerais do produtor (mês atual)
create or replace view v_owner_kpis_month as
select
  owner_id,
  sum(case when status='pago' then amount else 0 end)                  as receita_mes,
  count(case when status='pago' and created_at >= now()::date then 1 end) as vendas_hoje,
  (select count(*) from subscriptions s where s.owner_id = sales.owner_id and s.status='ativo') as assinaturas_ativas
from sales
where date_trunc('month', created_at) = date_trunc('month', now())
group by owner_id;

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────
alter table profiles     enable row level security;
alter table products     enable row level security;
alter table customers    enable row level security;
alter table sales        enable row level security;
alter table subscriptions enable row level security;
alter table affiliates   enable row level security;
alter table coproducers  enable row level security;
alter table messages     enable row level security;
alter table withdrawals  enable row level security;

-- Profiles: usuário vê/edita apenas o próprio
create policy "profiles_select_own" on profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

-- Products: owner gerencia seus produtos
create policy "products_owner"   on products for all using (auth.uid() = owner_id);
-- Afiliados podem ver produtos a que estão vinculados
create policy "products_affiliate" on products for select using (
  exists (select 1 from affiliates a where a.product_id = products.id and a.user_id = auth.uid())
);

-- Customers: owner vê seus clientes
create policy "customers_owner" on customers for all using (auth.uid() = owner_id);

-- Sales: owner vê suas vendas
create policy "sales_owner" on sales for all using (auth.uid() = owner_id);

-- Subscriptions: owner vê suas assinaturas
create policy "subscriptions_owner" on subscriptions for all using (auth.uid() = owner_id);

-- Affiliates: afiliado vê seus próprios registros + owner vê todos do produto
create policy "affiliates_select" on affiliates for select using (
  auth.uid() = user_id or
  exists (select 1 from products p where p.id = affiliates.product_id and p.owner_id = auth.uid())
);
create policy "affiliates_owner_manage" on affiliates for all using (
  exists (select 1 from products p where p.id = affiliates.product_id and p.owner_id = auth.uid())
);

-- Coproducers: mesmo padrão
create policy "coproducers_select" on coproducers for select using (
  auth.uid() = user_id or
  exists (select 1 from products p where p.id = coproducers.product_id and p.owner_id = auth.uid())
);
create policy "coproducers_owner_manage" on coproducers for all using (
  exists (select 1 from products p where p.id = coproducers.product_id and p.owner_id = auth.uid())
);

-- Messages: owner vê suas mensagens
create policy "messages_owner" on messages for all using (auth.uid() = owner_id);

-- Withdrawals: owner gerencia seus saques
create policy "withdrawals_owner" on withdrawals for all using (auth.uid() = owner_id);

-- ─── DADOS DE DEMONSTRAÇÃO ──────────────────────────────────
-- Execute SOMENTE em ambiente de desenvolvimento!
-- Descomente e ajuste o user_id com o UUID real do seu admin.

/*
-- Substitua 'SEU-USER-ID-AQUI' pelo UUID do usuário admin no Auth
do $$
declare
  v_owner uuid := 'SEU-USER-ID-AQUI';
  v_prod  uuid := uuid_generate_v4();
  v_cust1 uuid := uuid_generate_v4();
  v_cust2 uuid := uuid_generate_v4();
begin
  -- Produto
  insert into products(id,owner_id,name,url,price,type,status)
  values(v_prod,v_owner,'Protocolo G9','protocolog9.josephpay.com',297.00,'proprio','ativo');

  -- Clientes
  insert into customers(id,owner_id,name,email,phone,birthday)
  values(v_cust1,v_owner,'Ana Rodrigues','ana@email.com','+5511999990001','2000-04-19');
  insert into customers(id,owner_id,name,email,phone,birthday)
  values(v_cust2,v_owner,'João Pereira','joao@email.com','+5511999990002','1995-05-15');

  -- Vendas do mês
  insert into sales(product_id,customer_id,owner_id,amount,status)
  values(v_prod,v_cust1,v_owner,297.00,'pago'),
        (v_prod,v_cust2,v_owner,297.00,'pago');

  -- Assinatura ativa
  insert into subscriptions(product_id,customer_id,owner_id,plan,amount,status)
  values(v_prod,v_cust1,v_owner,'mensal',97.00,'ativo');
end;
$$;
*/
