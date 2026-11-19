-- Paya Music UG: separate member account types from staff/admin roles.
-- Existing registrations are intentionally marked unclassified because the
-- old role='artist' value was assigned to every registration, including listeners.

alter table public.users
  add column if not exists account_type text;

update public.users
set account_type = 'unclassified'
where account_type is null;

alter table public.users
  alter column account_type set default 'artist',
  alter column account_type set not null;

alter table public.users
  drop constraint if exists users_account_type_check;

alter table public.users
  add constraint users_account_type_check
  check (account_type in ('artist', 'listener', 'dj', 'artist_dj', 'unclassified'));

-- Identify what each new upload contains. Existing catalogue items remain
-- ordinary songs unless management later classifies them.
alter table public.songs
  add column if not exists upload_type text not null default 'song';

alter table public.songs
  drop constraint if exists songs_upload_type_check;

alter table public.songs
  add constraint songs_upload_type_check
  check (upload_type in ('song', 'dj_mix', 'remix'));

create index if not exists users_account_type_idx
  on public.users (account_type);

create index if not exists songs_upload_type_idx
  on public.songs (upload_type);
