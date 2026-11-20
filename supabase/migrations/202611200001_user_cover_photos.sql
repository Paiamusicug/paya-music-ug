-- Add a persistent cover image URL to member profiles.
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS cover_url text;
