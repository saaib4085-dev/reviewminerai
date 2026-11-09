-- =====================================================================
-- Review Miner: user settings (run after 001_review_miner.sql)
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

create table if not exists public.user_settings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references auth.users(id) on delete cascade,
  default_focuses  text[] not null default '{love,complaints,wishes}',
  detail           text not null default 'quick' check (detail in ('quick', 'detailed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Closing (removing) a chat deletes the analysis; its follow-up messages
-- are removed automatically by the ON DELETE CASCADE foreign key.
-- The delete policy below already exists in 001; repeated here for safety.
drop policy if exists "analyses_delete_own" on public.analyses;
create policy "analyses_delete_own" on public.analyses
  for delete using (auth.uid() = user_id);
