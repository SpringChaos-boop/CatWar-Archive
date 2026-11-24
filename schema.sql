-- CatWar Archive: основная схема Supabase.
-- Скрипт можно запускать повторно: политики перед созданием удаляются.
create extension if not exists pgcrypto;

create table if not exists public.archive_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_archive_admin()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (select 1 from public.archive_admins where user_id = auth.uid());
$$;

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(), -- внутренний ID архива; не игровой ID
  game_id text, -- необязательный и НЕ уникальный ID CatWar
  last_name text not null,
  birth_date date,
  death_date date,
  death_cause text,
  biography text,
  notes text,
  profile_url text,
  cover_url text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Миграция для уже созданной ранней версии таблицы characters.
alter table public.characters add column if not exists biography text;
alter table public.characters alter column game_id drop not null;
-- Удаляем уникальное ограничение только на game_id, если оно осталось от старой схемы.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'characters'
      and con.contype = 'u'
      and array_length(con.conkey, 1) = 1
      and (select attname from pg_attribute where attrelid = rel.oid and attnum = con.conkey[1]) = 'game_id'
  loop
    execute format('alter table public.characters drop constraint %I', constraint_row.conname);
  end loop;
end $$;

create table if not exists public.character_names (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  unique(character_id, position)
);

create table if not exists public.faction_periods (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  faction_name text not null,
  start_date date,
  end_date date,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check (start_date is null or end_date is null or start_date <= end_date)
);
alter table public.faction_periods add column if not exists position integer not null default 0;
-- Однократно восстанавливаем порядок старых периодов из прежней версии схемы.
with legacy as (
  select character_id, count(*) as amount, max(position) as max_position
  from public.faction_periods group by character_id
), numbered as (
  select fp.id, row_number() over (partition by fp.character_id order by fp.start_date nulls first, fp.created_at, fp.id) - 1 as new_position
  from public.faction_periods fp join legacy l using (character_id)
  where l.amount > 1 and l.max_position = 0
)
update public.faction_periods fp set position = numbered.new_position
from numbered where fp.id = numbered.id;

create table if not exists public.rank_periods (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  rank_name text not null,
  start_date date,
  end_date date,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check (start_date is null or end_date is null or start_date <= end_date)
);
alter table public.rank_periods add column if not exists position integer not null default 0;
with legacy as (
  select character_id, count(*) as amount, max(position) as max_position
  from public.rank_periods group by character_id
), numbered as (
  select rp.id, row_number() over (partition by rp.character_id order by rp.start_date nulls first, rp.created_at, rp.id) - 1 as new_position
  from public.rank_periods rp join legacy l using (character_id)
  where l.amount > 1 and l.max_position = 0
)
update public.rank_periods rp set position = numbered.new_position
from numbered where rp.id = numbered.id;

create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  image_url text not null,
  caption text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_characters_death_date on public.characters(death_date);
create index if not exists idx_characters_last_name on public.characters(last_name);
create index if not exists idx_characters_game_id on public.characters(game_id);
create index if not exists idx_faction_periods_character on public.faction_periods(character_id);
create index if not exists idx_rank_periods_character on public.rank_periods(character_id);
create index if not exists idx_character_names_name on public.character_names(name);

alter table public.archive_admins enable row level security;
alter table public.characters enable row level security;
alter table public.character_names enable row level security;
alter table public.faction_periods enable row level security;
alter table public.rank_periods enable row level security;
alter table public.gallery_items enable row level security;

-- Политики идемпотентны: повторный запуск SQL не вызовет ошибку из-за их имён.
drop policy if exists "Public can read admin-free character data" on public.characters;
drop policy if exists "Admins manage characters" on public.characters;
create policy "Public can read admin-free character data" on public.characters
for select using (deleted_at is null or public.is_archive_admin());
create policy "Admins manage characters" on public.characters
for all using (public.is_archive_admin()) with check (public.is_archive_admin());

drop policy if exists "Public can read names of public characters" on public.character_names;
drop policy if exists "Admins manage names" on public.character_names;
create policy "Public can read names of public characters" on public.character_names
for select using (exists(select 1 from public.characters c where c.id = character_id and c.deleted_at is null));
create policy "Admins manage names" on public.character_names
for all using (public.is_archive_admin()) with check (public.is_archive_admin());

drop policy if exists "Public can read faction history" on public.faction_periods;
drop policy if exists "Admins manage faction history" on public.faction_periods;
create policy "Public can read faction history" on public.faction_periods
for select using (exists(select 1 from public.characters c where c.id = character_id and c.deleted_at is null));
create policy "Admins manage faction history" on public.faction_periods
for all using (public.is_archive_admin()) with check (public.is_archive_admin());

drop policy if exists "Public can read rank history" on public.rank_periods;
drop policy if exists "Admins manage rank history" on public.rank_periods;
create policy "Public can read rank history" on public.rank_periods
for select using (exists(select 1 from public.characters c where c.id = character_id and c.deleted_at is null));
create policy "Admins manage rank history" on public.rank_periods
for all using (public.is_archive_admin()) with check (public.is_archive_admin());

drop policy if exists "Public can read gallery of public characters" on public.gallery_items;
drop policy if exists "Admins manage gallery" on public.gallery_items;
create policy "Public can read gallery of public characters" on public.gallery_items
for select using (exists(select 1 from public.characters c where c.id = character_id and c.deleted_at is null));
create policy "Admins manage gallery" on public.gallery_items
for all using (public.is_archive_admin()) with check (public.is_archive_admin());

drop policy if exists "Admins can read own admin record" on public.archive_admins;
create policy "Admins can read own admin record" on public.archive_admins
for select using (user_id = auth.uid());

-- Хранилище изображений. Bucket публичен для чтения, запись — только администраторам.
insert into storage.buckets (id, name, public)
values ('character-images', 'character-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Public can view character images" on storage.objects;
drop policy if exists "Admins can upload character images" on storage.objects;
drop policy if exists "Admins can update character images" on storage.objects;
drop policy if exists "Admins can delete character images" on storage.objects;
create policy "Public can view character images" on storage.objects
for select using (bucket_id = 'character-images');
create policy "Admins can upload character images" on storage.objects
for insert to authenticated
with check (bucket_id = 'character-images' and public.is_archive_admin());
create policy "Admins can update character images" on storage.objects
for update to authenticated
using (bucket_id = 'character-images' and public.is_archive_admin())
with check (bucket_id = 'character-images' and public.is_archive_admin());
create policy "Admins can delete character images" on storage.objects
for delete to authenticated
using (bucket_id = 'character-images' and public.is_archive_admin());

-- После создания пользователя в Supabase Auth, выполните отдельно:
-- insert into public.archive_admins(user_id) values ('UUID_АДМИНИСТРАТОРА');
