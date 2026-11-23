-- ════════════════════════════════════════════════════════════════════
-- Vitrine Zap: banco no Supabase.
-- Cole tudo no SQL Editor do projeto (Supabase → SQL Editor → New query)
-- e clique em Run. Pode rodar de novo sem problema: ele refaz as regras.
--
-- Modelo de negócio: quem cria as contas dos lojistas é a Neves Tecnologia
-- (Authentication → Users → Add user, com o cadastro pelo site desligado).
-- O lojista entra no painel e cuida da loja dele. Se a mensalidade atrasar,
-- a Neves Tecnologia muda "ativa" pra false no Table Editor e a loja sai do ar.
-- ════════════════════════════════════════════════════════════════════

-- Lojas: cada linha é uma loja inteira (nome, cores, produtos...) num JSON,
-- no mesmo formato que o app usa (js/dados.js, normalizarLoja).
create table if not exists public.lojas (
  slug text primary key check (slug ~ '^[a-z0-9-]{1,48}$'),
  dono uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dados jsonb not null,
  ativa boolean not null default true,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
alter table public.lojas add column if not exists ativa boolean not null default true;
create index if not exists lojas_dono on public.lojas (dono);

-- Pedidos enviados pelo catálogo (além da mensagem no WhatsApp)
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  loja text not null references public.lojas (slug) on delete cascade,
  status text not null default 'novo' check (status in ('novo', 'confirmado', 'entregue')),
  dados jsonb not null check (pg_column_size(dados) < 30000),
  criado_em timestamptz not null default now()
);
create index if not exists pedidos_loja on public.pedidos (loja, criado_em desc);

-- Data da última mudança, preenchida pelo próprio banco
create or replace function public.vz_atualizada_em() returns trigger
language plpgsql as $$
begin
  new.atualizada_em = now();
  return new;
end $$;
drop trigger if exists lojas_atualizada_em on public.lojas;
create trigger lojas_atualizada_em before update on public.lojas
  for each row execute function public.vz_atualizada_em();

-- ── Quem pode o quê (Row Level Security) ──
alter table public.lojas enable row level security;
alter table public.pedidos enable row level security;

-- O lojista só grava o endereço e o conteúdo da loja: "dono" e "ativa" ficam com a Neves Tecnologia
revoke insert, update on public.lojas from anon, authenticated;
grant select on public.lojas to anon, authenticated;
grant insert (slug, dados), update (slug, dados) on public.lojas to authenticated;
grant delete on public.lojas to authenticated;
grant insert on public.pedidos to anon, authenticated;
grant select, update, delete on public.pedidos to authenticated;

-- Lojas: qualquer pessoa vê as lojas ativas (o catálogo é público); o dono vê a dele mesmo pausada
drop policy if exists "catalogo publico" on public.lojas;
create policy "catalogo publico" on public.lojas
  for select using (ativa or dono = auth.uid());

drop policy if exists "dono cria a loja" on public.lojas;
create policy "dono cria a loja" on public.lojas
  for insert to authenticated with check (dono = auth.uid());

drop policy if exists "dono muda a loja" on public.lojas;
create policy "dono muda a loja" on public.lojas
  for update to authenticated using (dono = auth.uid()) with check (dono = auth.uid());

drop policy if exists "dono apaga a loja" on public.lojas;
create policy "dono apaga a loja" on public.lojas
  for delete to authenticated using (dono = auth.uid());

-- Pedidos: qualquer cliente envia pra uma loja ativa (sem login);
-- só o dono da loja vê, muda a situação e apaga
drop policy if exists "cliente envia pedido" on public.pedidos;
create policy "cliente envia pedido" on public.pedidos
  for insert to anon, authenticated
  with check (status = 'novo' and exists (select 1 from public.lojas l where l.slug = pedidos.loja and l.ativa));

drop policy if exists "dono ve os pedidos" on public.pedidos;
create policy "dono ve os pedidos" on public.pedidos
  for select to authenticated
  using (exists (select 1 from public.lojas l where l.slug = pedidos.loja and l.dono = auth.uid()));

drop policy if exists "dono muda a situacao" on public.pedidos;
create policy "dono muda a situacao" on public.pedidos
  for update to authenticated
  using (exists (select 1 from public.lojas l where l.slug = pedidos.loja and l.dono = auth.uid()))
  with check (exists (select 1 from public.lojas l where l.slug = pedidos.loja and l.dono = auth.uid()));

drop policy if exists "dono apaga o pedido" on public.pedidos;
create policy "dono apaga o pedido" on public.pedidos
  for delete to authenticated
  using (exists (select 1 from public.lojas l where l.slug = pedidos.loja and l.dono = auth.uid()));

-- ── Pedido novo aparece no painel na hora (Realtime) ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos'
  ) then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end $$;
