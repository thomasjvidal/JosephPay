-- ═══════════════════════════════════════════════════════════════════
--  migration_v46 — Treinamento de Embaixadores/Afiliados
--
--  Adiciona:
--  1. partner_type a profiles — distingue Embaixador de Afiliado
--     sem alterar a constraint de role (role permanece 'afiliado')
--  2. training_progress — 1 linha por usuário, estado dos checkpoints
--     e resumo do Teste Final
--  3. training_test_attempts — histórico completo de tentativas
--     (sem limite; todas preservadas)
--
--  Regra de aprovação: score / total >= 0.80 (80%)
--  NUNCA execute este SQL no Supabase remoto sem autorização do Thomas.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Tipo de parceiro em profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS partner_type text
  CHECK (partner_type IN ('embaixador', 'afiliado'));

-- 2. Progresso de treinamento (1 linha por usuário)
CREATE TABLE IF NOT EXISTS training_progress (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Checkpoints (1–4)
  ck1_completed_at           timestamptz,
  ck1_answer_correct         boolean,
  ck2_completed_at           timestamptz,
  ck2_answer_correct         boolean,
  ck3_completed_at           timestamptz,
  ck3_answer_correct         boolean,
  ck4_completed_at           timestamptz,
  ck4_answer_correct         boolean,

  -- Teste Final (resumo)
  final_test_attempts        int         NOT NULL DEFAULT 0,
  final_test_last_score      int,
  final_test_last_pct        numeric(5,2),
  final_test_passed          boolean,
  final_test_last_at         timestamptz,
  final_test_first_passed_at timestamptz,  -- preservado na primeira aprovação

  last_activity_at           timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now(),

  UNIQUE(user_id)
);

ALTER TABLE training_progress ENABLE ROW LEVEL SECURITY;

-- Usuário lê apenas o próprio progresso
CREATE POLICY "training_progress_select_own"
  ON training_progress FOR SELECT
  USING (auth.uid() = user_id);

-- Escrita feita exclusivamente pelo backend (service role — ignora RLS)

-- 3. Histórico completo de tentativas do Teste Final
CREATE TABLE IF NOT EXISTS training_test_attempts (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  attempt_num int          NOT NULL,
  score       int          NOT NULL,
  total       int          NOT NULL DEFAULT 10,
  pct         numeric(5,2) NOT NULL,
  passed      boolean      NOT NULL,
  answers     jsonb        NOT NULL DEFAULT '[]',
  created_at  timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE training_test_attempts ENABLE ROW LEVEL SECURITY;

-- Usuário lê apenas as próprias tentativas
CREATE POLICY "training_test_attempts_select_own"
  ON training_test_attempts FOR SELECT
  USING (auth.uid() = user_id);
