-- ═══════════════════════════════════════════════════════════════════
--  migration_v47 — Prospecção (Kanban do VJoseph dentro do Admin)
--
--  Ferramentas do modal "Mais" do Admin: Prospecção (Kanban), Mensagens e
--  Métricas. Os leads aqui são a prospecção do próprio Thomas (quem ele está
--  tentando trazer pro JosephPay) — NÃO são os contatos dos produtores
--  (esses continuam em customers). Antes tudo ficava no navegador / em
--  arquivos .json do VJoseph; agora fica salvo aqui.
--
--  Só tabelas novas — não mexe em nenhuma tabela que já existe.
--  Acesso só pelo servidor (service role): RLS ligado e sem policy.
--  NUNCA execute este SQL no Supabase remoto sem autorização do Thomas.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Leads da prospecção (1 cartão do Kanban)
CREATE TABLE IF NOT EXISTS prospeccao_leads (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL DEFAULT '',
  instagram          text,
  whatsapp           text,
  email              text,
  city               text,
  specialty          text,
  bio                text,
  avatar_url         text,
  site_link          text,
  notes              text,
  -- Etapa atual do Kanban (mesmos ids do VJoseph: coletados, dm1_enviada...)
  stage              text        NOT NULL DEFAULT 'coletados',
  follow_up_tag      text,
  -- [{ "s": "dm1_enviada", "at": "2026-10-16T12:00:00Z" }] — entrada em cada etapa
  stage_entries      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "at", "acao", "de", "para", "texto", "msg_id", "visto", "respondeu" }]
  history            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  dm1_sent_at        timestamptz,
  dm2_sent_at        timestamptz,
  site_generated_at  timestamptz,
  proposta_sent_at   timestamptz,
  closed_at          timestamptz,
  archived_at        timestamptz,
  -- Quando o lead vira produtor do JosephPay (botão "Vincular")
  linked_profile_id  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  origem             text,
  -- id do lead no VJoseph (importação) — evita duplicar se importar 2x
  vjoseph_id         text        UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX IF NOT EXISTS prospeccao_leads_stage ON prospeccao_leads(stage) WHERE deleted_at IS NULL;

-- 2. Mensagens por etapa (o antigo "Lab de Mensagens")
CREATE TABLE IF NOT EXISTS prospeccao_mensagens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria   text        NOT NULL DEFAULT 'dm1',
  nome        text        NOT NULL DEFAULT '',
  texto       text        NOT NULL DEFAULT '',
  vjoseph_id  text        UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- 3. Configuração (preço do serviço, metas) — 1 linha "geral"
CREATE TABLE IF NOT EXISTS prospeccao_config (
  id          text        PRIMARY KEY,
  value       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE prospeccao_leads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospeccao_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospeccao_config    ENABLE ROW LEVEL SECURITY;

-- 4. Mensagens que o Thomas já testou no VJoseph (só o nome da pessoa e o link
--    viraram variável: {nome} e {link_site}). ON CONFLICT: rodar 2x não duplica.
INSERT INTO prospeccao_mensagens (categoria, nome, texto, vjoseph_id) VALUES
('dm1', 'DM1 (VJoseph)', $m$Eii doutora {nome}, tudo joia?

Vi que você segue alguns de nossos amigos queridos e clientes, meu nome é Milena 🤍

Fizemos vários trabalhos com estrutura digital para clínicas
Analisei alguns perfis de nutricionistas da região e notei algo no seu perfil que talvez esteja fazendo você perder bastante pacientes que chegam pelo Google

Zero compromisso
Acredito que vai mudar toda a cara da empresa
Posso te mostrar por aqui msm a minha ideia?$m$, 'copy_1775150746985'),
('dm2', 'DM2 (VJoseph)', $m$Perfeito, obrigada Dra 🤍

Quando comentei sobre perder pacientes, não é nem pelo Instagram ou pelas indicações da clínica, isso normalmente já funciona bem

O que acontece é que muitas pessoas recebem uma indicação ou encontram o profissional pelo Instagram e, antes de marcar a consulta, pesquisam para entender melhor quem é, como funciona o atendimento e se faz sentido para elas

E também tem quem simplesmente procure direto no Google algo como “nutricionista na região” quando precisa

Quando não existe um lugar claro reunindo essas informações, o paciente muitas vezes não consegue entender bem o trabalho do profissional, tivemos um exemplo disso essa semana com a Dra Deyse e o Renato Gonai

Pensando nisso, organizei um protótipo simples usando suas infos públicas só para ilustrar como poderia ser uma página sua reunindo tudo em um único lugar

{link_site}

Depois me conta o que achou da sua página Dra, Deus abençoe seu dia 🙌🏼$m$, 'copy_1775150899651'),
('fu2', 'FU2 (VJoseph)', $m$Boa tarde, Dra! 🙏🏼

Fiquei pensando aqui... tem alguma dúvida sobre a página ou algo que você gostaria de ajustar antes de fechar?

Posso te mostrar exemplos de outras nutricionistas ou a gente pode fazer alguma personalização que você tenha em mente. O que acha?$m$, 'copy_1775151130113'),
('proposta_wpp', 'Proposta (VJoseph)', $m$Boa tarde, Dra! Fico feliz que tenha gostado 🙏🏼

Funciona assim, eu entrego a página já pronta e personalizada com suas informações (texto, fotos, serviços, tudo organizado certinho)
Esses ajustes que você comentou nós fazemos juntos, pode ficar tranquila, eu deixo exatamente do jeito que fizer mais sentido para você

Sobre o domínio pode sim, e é o ideal
Eu mesmo configuro para você (ex: www.seunome.com), tudo já conectado certinho, sem dor de cabeça
Mas se quiser deixar do jeito que ele está hoje, tudo bem tbm (gratuito)

Se quiser, posso te enviar agora o link com as opções de pagamento (Pix, boleto ou cartão em até 12x)
Hoje está saindo por 297 e a maioria das doutoras estão parcelando porque fica mais leve

Assim que você confirmar, eu já te chamo no WhatsApp, a gente ajusta texto, fotos, tudo do seu jeito e em até 24h sua página já tá no ar recebendo suas novas pacientes

Só me avisar aqui que te mando o link e iniciamos$m$, 'copy_1775151210296'),
('fu3', 'FU3 (VJoseph)', $m$Boa tarde Dra {nome}, tudo joia? 🤍
Só pra te dar um retorno rápido

Estou organizando aqui as páginas que vou subir hoje e vi a sua aqui, e sei que seu perfil já está pronto pra converter bem com a estrutura que te mostrei

Se fizer sentido, posso te chamar no WhatsApp e te mostrar como ficaria já com seus dados aplicados?$m$, 'copy_1775151247830')
ON CONFLICT (vjoseph_id) DO NOTHING;
