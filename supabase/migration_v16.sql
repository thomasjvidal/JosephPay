-- ═══════════════════════════════════════════════════════════════════
--  migration_v16 — Assinatura mensal da plataforma JosephPay
--  Mensalidade dos USUÁRIOS que usam o JosephPay: 1 mês grátis → R$30/mês.
--  Trava funcionalidades premium (chat IA, disparo) quando o mês grátis
--  acaba e não há assinatura ativa. Desbloqueio automático ao pagar.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Campos de controle de acesso no perfil do usuário
alter table profiles
  add column if not exists access_until      timestamptz,          -- acesso liberado enquanto now() < access_until
  add column if not exists plan_status        text default 'trial', -- trial | active | past_due | canceled | none
  add column if not exists mp_preapproval_id  text,                 -- id da assinatura no cartão (Mercado Pago)
  add column if not exists trial_started_at   timestamptz;

-- 2. Trial de 30 dias contados a partir do CADASTRO de cada usuário.
--    Quem já usa há MAIS de 30 dias entra bloqueado (precisa assinar);
--    quem tem menos de 30 dias continua liberado até completar o mês.
update profiles
   set access_until      = created_at + interval '30 days',
       trial_started_at  = coalesce(trial_started_at, created_at),
       plan_status       = 'trial'
 where access_until is null;

-- 3. Novos cadastros já entram com 30 dias grátis automaticamente
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, name, role, access_until, trial_started_at, plan_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'role', 'client'),
    now() + interval '30 days',
    now(),
    'trial'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
