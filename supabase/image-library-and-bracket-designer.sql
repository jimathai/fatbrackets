-- FatBrackets reusable image library + per-bracket designer settings
-- Run once in Supabase Dashboard > SQL Editor.

create extension if not exists pg_trgm;

alter table public.tournaments
  add column if not exists theme_json jsonb not null default '{}'::jsonb;

create table if not exists public.image_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  normalized_name text not null,
  storage_path text not null unique,
  public_url text not null,
  content_hash text not null unique,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  file_size bigint not null check (file_size >= 0),
  mime_type text not null default 'image/webp',
  usage_count integer not null default 1 check (usage_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contestants
  add column if not exists image_asset_id uuid references public.image_assets(id) on delete set null;

create index if not exists image_assets_normalized_name_trgm_idx
  on public.image_assets using gin (normalized_name gin_trgm_ops);
create index if not exists image_assets_usage_idx on public.image_assets(usage_count desc);
create index if not exists contestants_image_asset_idx on public.contestants(image_asset_id);

alter table public.image_assets enable row level security;

drop policy if exists "image assets are readable" on public.image_assets;
create policy "image assets are readable"
on public.image_assets for select
using (true);

drop policy if exists "users create image assets" on public.image_assets;
create policy "users create image assets"
on public.image_assets for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "owners update image assets" on public.image_assets;
create policy "owners update image assets"
on public.image_assets for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "owners delete unused image assets" on public.image_assets;
create policy "owners delete unused image assets"
on public.image_assets for delete
to authenticated
using (auth.uid() = owner_id and usage_count = 0);

create or replace function public.increment_image_asset_usage(asset_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.image_assets
  set usage_count = usage_count + 1,
      updated_at = now()
  where id = asset_id;
$$;

grant execute on function public.increment_image_asset_usage(uuid) to anon, authenticated;

-- Keep the existing public bucket and ownership-based upload rules.
insert into storage.buckets (id, name, public)
values ('contestant-images', 'contestant-images', true)
on conflict (id) do update set public = true;
