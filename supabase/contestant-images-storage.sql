-- Run this once in Supabase SQL Editor if contestant image uploads report a storage error.

insert into storage.buckets (id, name, public)
values ('contestant-images', 'contestant-images', true)
on conflict (id) do update set public = true;

drop policy if exists "contestant images are public" on storage.objects;
create policy "contestant images are public"
on storage.objects for select
using (bucket_id = 'contestant-images');

drop policy if exists "users upload contestant images" on storage.objects;
create policy "users upload contestant images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'contestant-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users update their contestant images" on storage.objects;
create policy "users update their contestant images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'contestant-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users delete their contestant images" on storage.objects;
create policy "users delete their contestant images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'contestant-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
