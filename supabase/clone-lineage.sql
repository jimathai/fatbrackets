-- FatBrackets v2.7 clone lineage
-- Run once in Supabase Dashboard > SQL Editor.

alter table public.tournaments
  add column if not exists cloned_from_id uuid references public.tournaments(id) on delete set null,
  add column if not exists cloned_from_name text;

create index if not exists tournaments_cloned_from_idx on public.tournaments(cloned_from_id);
