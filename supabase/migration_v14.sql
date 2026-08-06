-- Renomeia tabela page_view → begin_checkout
ALTER TABLE tracking.page_view RENAME TO begin_checkout;

-- Adiciona permissão de leitura (SELECT) para anon key
create policy "anon_select"
  on tracking.begin_checkout
  as permissive
  for select
  to anon
  using (true);
