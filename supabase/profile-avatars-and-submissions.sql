-- FatBrackets profile avatars, public creator profiles and Fill Out & Submit
-- Run after profiles-favorites-remix.sql.

alter table public.profiles
  add column if not exists avatar_url text not null default '';

-- Profiles are intentionally public-facing; users may edit only their own row.
alter table public.profiles enable row level security;
drop policy if exists "public profiles are readable" on public.profiles;
create policy "public profiles are readable"
on public.profiles for select
using (true);

drop policy if exists "users create their profile" on public.profiles;
create policy "users create their profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "users update their profile" on public.profiles;
create policy "users update their profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "profile avatars are public" on storage.objects;
create policy "profile avatars are public"
on storage.objects for select
using (bucket_id = 'profile-avatars');

drop policy if exists "users upload their profile avatar" on storage.objects;
create policy "users upload their profile avatar"
on storage.objects for insert
with check (
  bucket_id = 'profile-avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "users update their profile avatar" on storage.objects;
create policy "users update their profile avatar"
on storage.objects for update
using (
  bucket_id = 'profile-avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'profile-avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create table if not exists public.bracket_submissions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  picks jsonb not null default '{}'::jsonb,
  champion_id uuid null references public.contestants(id) on delete set null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);

create index if not exists bracket_submissions_user_idx on public.bracket_submissions(user_id, submitted_at desc);
create index if not exists bracket_submissions_tournament_idx on public.bracket_submissions(tournament_id, submitted_at desc);

alter table public.bracket_submissions enable row level security;

drop policy if exists "users read their submitted brackets" on public.bracket_submissions;
create policy "users read their submitted brackets"
on public.bracket_submissions for select
using (auth.uid() = user_id);

drop policy if exists "owners read submissions to their brackets" on public.bracket_submissions;
create policy "owners read submissions to their brackets"
on public.bracket_submissions for select
using (
  exists (
    select 1 from public.tournaments t
    where t.id = tournament_id and t.owner_id = auth.uid()
  )
);

drop policy if exists "users submit public brackets" on public.bracket_submissions;
create policy "users submit public brackets"
on public.bracket_submissions for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.tournaments t
    where t.id = tournament_id
      and t.visibility in ('public','unlisted')
      and t.owner_id <> auth.uid()
  )
);

drop policy if exists "users update their submission" on public.bracket_submissions;
create policy "users update their submission"
on public.bracket_submissions for update
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.tournaments t
    where t.id = tournament_id
      and t.visibility in ('public','unlisted')
      and t.owner_id <> auth.uid()
  )
);
