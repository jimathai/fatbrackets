-- Shared, reusable FatBrackets design styles.
-- Run after image-library-and-bracket-designer.sql.

create table if not exists public.bracket_styles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  theme_json jsonb not null default '{}'::jsonb,
  is_public boolean not null default true,
  usage_count integer not null default 0 check (usage_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bracket_styles_public_usage_idx
  on public.bracket_styles (is_public, usage_count desc, created_at desc);

create index if not exists bracket_styles_owner_idx
  on public.bracket_styles (owner_id, created_at desc);

alter table public.bracket_styles enable row level security;

drop policy if exists "Public styles are readable" on public.bracket_styles;
create policy "Public styles are readable"
  on public.bracket_styles for select
  using (is_public = true or auth.uid() = owner_id);

drop policy if exists "Users can create their own styles" on public.bracket_styles;
create policy "Users can create their own styles"
  on public.bracket_styles for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "Users can update their own styles" on public.bracket_styles;
create policy "Users can update their own styles"
  on public.bracket_styles for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Users can delete their own styles" on public.bracket_styles;
create policy "Users can delete their own styles"
  on public.bracket_styles for delete
  to authenticated
  using (auth.uid() = owner_id);

create or replace function public.increment_bracket_style_usage(style_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bracket_styles
  set usage_count = usage_count + 1,
      updated_at = now()
  where id = style_id
    and is_public = true;
$$;

grant execute on function public.increment_bracket_style_usage(uuid) to anon, authenticated;
