-- FatBrackets ownership security hardening
-- Run once in Supabase SQL Editor before publishing.

alter table public.tournaments enable row level security;
alter table public.contestants enable row level security;
alter table public.matches enable row level security;

-- Tournament writes are owner-only. Public brackets remain readable.
drop policy if exists "owners manage tournaments" on public.tournaments;
create policy "owners manage tournaments"
on public.tournaments for all
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "published tournaments are readable" on public.tournaments;
create policy "published tournaments are readable"
on public.tournaments for select
to anon, authenticated
using (visibility = 'public' and status in ('published', 'completed'));

-- Contestant writes require ownership of the parent bracket.
drop policy if exists "owners manage contestants" on public.contestants;
create policy "owners manage contestants"
on public.contestants for all
to authenticated
using (exists (
  select 1 from public.tournaments t
  where t.id = tournament_id and t.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.tournaments t
  where t.id = tournament_id and t.owner_id = auth.uid()
));

-- Match writes require ownership of the parent bracket.
drop policy if exists "owners manage matches" on public.matches;
create policy "owners manage matches"
on public.matches for all
to authenticated
using (exists (
  select 1 from public.tournaments t
  where t.id = tournament_id and t.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.tournaments t
  where t.id = tournament_id and t.owner_id = auth.uid()
));
