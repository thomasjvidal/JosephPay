-- ═══════════════════════════════════════════════════════════════════
--  migration_v23 — Integração GitHub (admin-only)
--  Guarda a autorização do GitHub (uma única conta, a sua/da sua equipe)
--  e, por cliente, em qual repositório + arquivo instalar o sensor via
--  commit direto — pra quando o site do cliente é código próprio que
--  você mantém, não uma plataforma pronta (Wix/WordPress/etc).
-- ═══════════════════════════════════════════════════════════════════

-- Autorização única da plataforma (uma linha só, id sempre = 1).
-- Nunca é exposta ao frontend — só o backend (service role) lê/escreve aqui.
create table if not exists platform_github_auth (
  id              int primary key default 1,
  access_token    text,
  connected_login text,
  updated_at      timestamptz default now(),
  constraint platform_github_auth_single_row check (id = 1)
);

alter table platform_github_auth enable row level security;
-- Sem policies de SELECT/INSERT/UPDATE para anon/authenticated —
-- só a service role (usada pelo backend) acessa esta tabela.

-- Vínculo de cada produtor com um repositório + arquivo no GitHub.
alter table profiles add column if not exists github_repo text;                    -- "owner/repo"
alter table profiles add column if not exists github_file_path text;               -- "index.html"
alter table profiles add column if not exists github_sensor_installed_at timestamptz;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────
-- SELECT connected_login, updated_at FROM platform_github_auth WHERE id = 1;
-- SELECT name, github_repo, github_file_path, github_sensor_installed_at FROM profiles WHERE github_repo IS NOT NULL;
