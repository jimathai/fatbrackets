-- FatBrackets tags + visibility migration
-- Run once in Supabase Dashboard > SQL Editor for an existing project.

alter table public.tournaments
  add column if not exists tags text[] not null default array['Undefined']::text[];

update public.tournaments
set tags = array['Undefined']::text[]
where tags is null or cardinality(tags) = 0;

create index if not exists tournaments_tags_gin_idx
  on public.tournaments using gin (tags);
