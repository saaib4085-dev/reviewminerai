-- =====================================================================
-- Review Miner: full database setup
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run on a fresh project.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Shared trigger: keep updated_at fresh ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Profiles (one per user, holds the credit balance) ----------
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  email       text,
  credits     integer not null default 3 check (credits >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- Analyses (one per product link searched) ----------
create table if not exists public.analyses (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  url              text not null,
  product_name     text,
  focuses          text[] not null default '{}',
  question         text,
  report           jsonb not null,
  source_markdown  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists analyses_user_created_idx on public.analyses (user_id, created_at desc);

-- ---------- Follow-up questions asked about an analysis ----------
create table if not exists public.analysis_messages (
  id           uuid primary key default gen_random_uuid(),
  analysis_id  uuid not null references public.analyses(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  question     text not null,
  answer       jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists analysis_messages_analysis_idx on public.analysis_messages (analysis_id, created_at);

-- ---------- Credit ledger (every + and - is recorded) ----------
create table if not exists public.credit_transactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  amount             integer not null,
  balance_after      integer not null,
  reason             text not null check (reason in ('signup_bonus', 'analysis', 'follow_up', 'purchase', 'refund')),
  analysis_id        uuid references public.analyses(id) on delete set null,
  stripe_session_id  text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists credit_transactions_user_idx on public.credit_transactions (user_id, created_at desc);

-- ---------- updated_at triggers ----------
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists analyses_updated_at on public.analyses;
create trigger analyses_updated_at before update on public.analyses
  for each row execute function public.set_updated_at();

drop trigger if exists analysis_messages_updated_at on public.analysis_messages;
create trigger analysis_messages_updated_at before update on public.analysis_messages
  for each row execute function public.set_updated_at();

drop trigger if exists credit_transactions_updated_at on public.credit_transactions;
create trigger credit_transactions_updated_at before update on public.credit_transactions
  for each row execute function public.set_updated_at();

-- ---------- New users get a profile + 3 free credits ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, credits)
  values (new.id, new.email, 3)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (user_id, amount, balance_after, reason)
  values (new.id, 3, 3, 'signup_bonus');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Atomic credit spend (server only) ----------
-- Returns the new balance, or -1 if the user had no credits left.
create or replace function public.consume_credit(
  p_user_id uuid,
  p_reason text,
  p_analysis_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  update public.profiles
     set credits = credits - 1
   where user_id = p_user_id
     and credits >= 1
  returning credits into v_balance;

  if v_balance is null then
    return -1;
  end if;

  insert into public.credit_transactions (user_id, amount, balance_after, reason, analysis_id)
  values (p_user_id, -1, v_balance, p_reason, p_analysis_id);

  return v_balance;
end;
$$;

-- ---------- Idempotent credit top-up from Stripe (server only) ----------
create or replace function public.add_credits(
  p_user_id uuid,
  p_amount integer,
  p_stripe_session_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  -- Stripe can send the same event more than once: only credit it once.
  if exists (select 1 from public.credit_transactions where stripe_session_id = p_stripe_session_id) then
    select credits into v_balance from public.profiles where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  update public.profiles
     set credits = credits + p_amount
   where user_id = p_user_id
  returning credits into v_balance;

  if v_balance is null then
    raise exception 'profile not found for user %', p_user_id;
  end if;

  insert into public.credit_transactions (user_id, amount, balance_after, reason, stripe_session_id)
  values (p_user_id, p_amount, v_balance, 'purchase', p_stripe_session_id);

  return v_balance;
end;
$$;

revoke all on function public.consume_credit(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.add_credits(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.consume_credit(uuid, text, uuid) to service_role;
grant execute on function public.add_credits(uuid, integer, text) to service_role;

-- =====================================================================
-- Row Level Security
-- Users can read their own rows. Credit balances and the credit ledger
-- can only be changed by the server (service role) through the
-- functions above, so nobody can give themselves free credits.
-- =====================================================================

alter table public.profiles             enable row level security;
alter table public.analyses             enable row level security;
alter table public.analysis_messages    enable row level security;
alter table public.credit_transactions  enable row level security;

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id and credits <= 3);
-- No UPDATE policy on purpose: balances change only via consume_credit / add_credits.

-- analyses
drop policy if exists "analyses_select_own" on public.analyses;
create policy "analyses_select_own" on public.analyses
  for select using (auth.uid() = user_id);

drop policy if exists "analyses_insert_own" on public.analyses;
create policy "analyses_insert_own" on public.analyses
  for insert with check (auth.uid() = user_id);

drop policy if exists "analyses_delete_own" on public.analyses;
create policy "analyses_delete_own" on public.analyses
  for delete using (auth.uid() = user_id);

-- analysis_messages
drop policy if exists "analysis_messages_select_own" on public.analysis_messages;
create policy "analysis_messages_select_own" on public.analysis_messages
  for select using (auth.uid() = user_id);

drop policy if exists "analysis_messages_insert_own" on public.analysis_messages;
create policy "analysis_messages_insert_own" on public.analysis_messages
  for insert with check (auth.uid() = user_id);

-- credit_transactions: read-only for users (writes happen in the functions above)
drop policy if exists "credit_transactions_select_own" on public.credit_transactions;
create policy "credit_transactions_select_own" on public.credit_transactions
  for select using (auth.uid() = user_id);

-- Backfill profiles for any users who signed up before this script ran.
insert into public.profiles (user_id, email, credits)
select u.id, u.email, 3 from auth.users u
on conflict (user_id) do nothing;
