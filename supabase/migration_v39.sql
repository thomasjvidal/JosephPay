-- v39: contador de quantas vezes um contato voltou
-- Nenhum dos três caminhos que criam `customers` (Adicionar contatos do Admin,
-- import de CSV, Mini Chat) de fato evitava duplicata por telefone — o import de CSV
-- tentava um upsert com ON CONFLICT numa constraint que nunca existiu, caía no
-- fallback (insert linha a linha) e duplicava igual aos outros dois. Em vez de tentar
-- uma constraint única no banco (a base já tem duplicatas reais acumuladas, criaria
-- na hora de rodar), o dedup passa a ser feito em código: antes de inserir, procura
-- por telefone; se já existe, incrementa esse contador em vez de criar outra linha.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS times_seen int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
