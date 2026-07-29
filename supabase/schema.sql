-- FatBrackets initial database
-- Run this entire file in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text,
  slug text not null unique,
  bracket_size integer not null check (bracket_size in (4, 8, 16, 32, 64)),
  status text not null default 'draft' check (status in ('draft', 'published', 'completed')),
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  tags text[] not null default array['Undefined']::text[],
  voting_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contestants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  seed integer not null check (seed > 0),
  name text not null,
  short_name text,
  details text,
  image_url text,
  accent_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, seed)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  match_number integer not null check (match_number > 0),
  contestant_one_id uuid references public.contestants(id) on delete set null,
  contestant_two_id uuid references public.contestants(id) on delete set null,
  winner_id uuid references public.contestants(id) on delete set null,
  next_match_id uuid references public.matches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, round_number, match_number)
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  contestant_id uuid not null references public.contestants(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (match_id, voter_id)
);

create index if not exists tournaments_owner_idx on public.tournaments(owner_id);
create index if not exists tournaments_tags_gin_idx on public.tournaments using gin (tags);
create index if not exists contestants_tournament_idx on public.contestants(tournament_id);
create index if not exists matches_tournament_idx on public.matches(tournament_id);
create index if not exists votes_match_idx on public.votes(match_id);

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.contestants enable row level security;
alter table public.matches enable row level security;
alter table public.votes enable row level security;

create policy "profiles are readable"
on public.profiles for select using (true);

create policy "users manage their profile"
on public.profiles for all
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "owners manage tournaments"
on public.tournaments for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "published tournaments are readable"
on public.tournaments for select
using (status in ('published', 'completed') and visibility in ('unlisted', 'public'));

create policy "owners manage contestants"
on public.contestants for all
using (
  exists (
    select 1 from public.tournaments t
    where t.id = tournament_id and t.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.tournaments t
    where t.id = tournament_id and t.owner_id = auth.uid()
  )
);

create policy "public tournament contestants are readable"
on public.contestants for select
using (
  exists (
    select 1 from public.tournaments t
    where t.id = tournament_id
      and t.status in ('published', 'completed')
      and t.visibility in ('unlisted', 'public')
  )
);

create policy "owners manage matches"
on public.matches for all
using (
  exists (
    select 1 from public.tournaments t
    where t.id = tournament_id and t.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.tournaments t
    where t.id = tournament_id and t.owner_id = auth.uid()
  )
);

create policy "public tournament matches are readable"
on public.matches for select
using (
  exists (
    select 1 from public.tournaments t
    where t.id = tournament_id
      and t.status in ('published', 'completed')
      and t.visibility in ('unlisted', 'public')
  )
);

create policy "signed in users can vote"
on public.votes for insert
with check (
  auth.uid() = voter_id
  and exists (
    select 1
    from public.matches m
    join public.tournaments t on t.id = m.tournament_id
    where m.id = match_id
      and t.voting_enabled = true
      and t.status = 'published'
  )
);

create policy "users manage their votes"
on public.votes for update
using (auth.uid() = voter_id)
with check (auth.uid() = voter_id);

create policy "users delete their votes"
on public.votes for delete
using (auth.uid() = voter_id);

create policy "votes on public tournaments are readable"
on public.votes for select
using (
  exists (
    select 1
    from public.matches m
    join public.tournaments t on t.id = m.tournament_id
    where m.id = match_id
      and t.visibility in ('unlisted', 'public')
  )
);

insert into storage.buckets (id, name, public)
values ('contestant-images', 'contestant-images', true)
on conflict (id) do nothing;

create policy "contestant images are public"
on storage.objects for select
using (bucket_id = 'contestant-images');

create policy "users upload contestant images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'contestant-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users update their contestant images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'contestant-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users delete their contestant images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'contestant-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
