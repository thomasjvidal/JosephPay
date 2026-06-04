-- Tabela para tracking server-side (sGTM / Stape)
-- Cada linha é uma sessão identificada pelo xcod
-- Acesso via Supabase REST API com service_role key

create schema if not exists tracking;

create table tracking.page_view (
  -- Identidade
  id                uuid primary key default gen_random_uuid(),
  xcod              text not null unique,
  client_id         uuid not null,

  -- Meta
  fbc               text,
  fbp               text,
  fbclid            text,

  -- Google
  gclid             text,
  fpgclaw           text,

  -- GA4
  ga_client_id      text,
  ga_session_id     text,
  ga_session_number integer,

  -- UTMs
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_term          text,
  utm_content       text,
  utm_id            text,

  -- Rede / Dispositivo
  ip                text,
  user_agent        text,

  -- Geo (Cloudflare)
  country           text,
  city              text,
  region            text,
  postal_code       text,

  -- Timestamps
  created_at        timestamptz not null default now()
);

-- Índices
create index idx_page_view_client_id   on tracking.page_view (client_id);
create index idx_page_view_created_at  on tracking.page_view (created_at desc);
create index idx_page_view_ga_session  on tracking.page_view (ga_session_id) where ga_session_id is not null;

-- RLS
alter table tracking.page_view enable row level security;

create policy "service_role_full_access"
  on tracking.page_view
  as permissive
  for all
  to service_role
  using (true)
  with check (true);
