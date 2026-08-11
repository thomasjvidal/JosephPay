-- ═══════════════════════════════════════════════════════════════════
--  migration_v22 — Integração Google Tag Manager (admin-only)
--  Guarda a autorização do Google (uma única conta, a sua) e, por
--  cliente, qual container do GTM foi vinculado a ele — pra instalar
--  o sensor remotamente sem colar código no site do cliente.
-- ═══════════════════════════════════════════════════════════════════

-- Autorização única da plataforma (uma linha só, id sempre = 1).
-- Nunca é exposta ao frontend — só o backend (service role) lê/escreve aqui.
create table if not exists platform_google_auth (
  id             int primary key default 1,
  access_token   text,
  refresh_token  text,
  expires_at     timestamptz,
  connected_email text,
  updated_at     timestamptz default now(),
  constraint platform_google_auth_single_row check (id = 1)
);

alter table platform_google_auth enable row level security;
-- Sem policies de SELECT/INSERT/UPDATE para anon/authenticated —
-- só a service role (usada pelo backend) acessa esta tabela.

-- Vínculo de cada produtor com um container do GTM da sua conta.
alter table profiles add column if not exists gtm_account_id text;
alter table profiles add column if not exists gtm_container_id text;
alter table profiles add column if not exists gtm_container_name text;
alter table profiles add column if not exists gtm_sensor_installed_at timestamptz;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT connected_email, updated_at FROM platform_google_auth WHERE id = 1;
-- SELECT name, gtm_container_name, gtm_sensor_installed_at FROM profiles WHERE gtm_container_id IS NOT NULL;
