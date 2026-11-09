-- =====================================================================
-- Review Miner: COMPLETE database setup (files 001–017 in one)
--
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run on a new project AND on a project where some of the setup was
-- already done: existing tables, data, credits and codes are kept, and the
-- voucher codes are only generated if you don't have them yet.
-- =====================================================================

-- #####################################################################
-- ## 001_review_miner.sql
-- #####################################################################

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

-- #####################################################################
-- ## 002_settings.sql
-- #####################################################################

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

-- #####################################################################
-- ## 003_decimal_credits.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: decimal credits (run after 001 and 002)
-- Each product link costs 1.5 credits, so balances need one decimal place.
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

-- A column used in a policy can't change type, so drop the policy first.
drop policy if exists "profiles_insert_own" on public.profiles;

alter table public.profiles
  alter column credits type numeric(10,1) using credits::numeric,
  alter column credits set default 3;

alter table public.credit_transactions
  alter column amount type numeric(10,1) using amount::numeric,
  alter column balance_after type numeric(10,1) using balance_after::numeric;

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id and credits <= 3);

-- ---------- Spend any amount of credits atomically (server only) ----------
drop function if exists public.consume_credit(uuid, text, uuid);
drop function if exists public.consume_credits(uuid, numeric, text, uuid);

create function public.consume_credits(
  p_user_id uuid,
  p_amount numeric,
  p_reason text,
  p_analysis_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  update public.profiles
     set credits = credits - p_amount
   where user_id = p_user_id
     and credits >= p_amount
  returning credits into v_balance;

  if v_balance is null then
    return -1;
  end if;

  insert into public.credit_transactions (user_id, amount, balance_after, reason, analysis_id)
  values (p_user_id, -p_amount, v_balance, p_reason, p_analysis_id);

  return v_balance;
end;
$$;

-- ---------- Idempotent top-up from Stripe (server only) ----------
drop function if exists public.add_credits(uuid, integer, text);
drop function if exists public.add_credits(uuid, numeric, text);

create function public.add_credits(
  p_user_id uuid,
  p_amount numeric,
  p_stripe_session_id text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

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

revoke all on function public.consume_credits(uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.add_credits(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.consume_credits(uuid, numeric, text, uuid) to service_role;
grant execute on function public.add_credits(uuid, numeric, text) to service_role;

-- #####################################################################
-- ## 004_payment_links.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: Stripe Payment Links support (run after 001–003)
-- If someone pays through a Payment Link before they have an account,
-- their credits are held here and added the moment they sign up with
-- the same email.
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

create table if not exists public.pending_credit_purchases (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  credits            numeric(10,1) not null check (credits > 0),
  stripe_session_id  text not null unique,
  claimed_by         uuid references auth.users(id) on delete set null,
  claimed_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists pending_credit_purchases_email_idx
  on public.pending_credit_purchases (lower(email))
  where claimed_at is null;

drop trigger if exists pending_credit_purchases_updated_at on public.pending_credit_purchases;
create trigger pending_credit_purchases_updated_at before update on public.pending_credit_purchases
  for each row execute function public.set_updated_at();

-- Server only: RLS on with no policies, so only the service role can read or write.
alter table public.pending_credit_purchases enable row level security;

-- New users: profile + 3 free credits + any purchases made with their email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric := 3;
  r record;
begin
  insert into public.profiles (user_id, email, credits)
  values (new.id, new.email, 3)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (user_id, amount, balance_after, reason)
  values (new.id, 3, 3, 'signup_bonus');

  if new.email is not null then
    for r in
      select * from public.pending_credit_purchases
       where lower(email) = lower(new.email)
         and claimed_at is null
       order by created_at
       for update
    loop
      v_balance := v_balance + r.credits;

      update public.profiles set credits = credits + r.credits where user_id = new.id;

      insert into public.credit_transactions (user_id, amount, balance_after, reason, stripe_session_id)
      values (new.id, r.credits, v_balance, 'purchase', r.stripe_session_id)
      on conflict (stripe_session_id) do nothing;

      update public.pending_credit_purchases
         set claimed_by = new.id, claimed_at = now()
       where id = r.id;
    end loop;
  end if;

  return new;
end;
$$;

-- #####################################################################
-- ## 005_nine_free_credits.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: 9 free credits for new accounts (run after 001–004)
-- Supabase > SQL Editor > New query > paste > Run.
-- Existing accounts keep their current balance.
-- =====================================================================

alter table public.profiles alter column credits set default 9;

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id and credits <= 9);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric := 9;
  r record;
begin
  insert into public.profiles (user_id, email, credits)
  values (new.id, new.email, 9)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (user_id, amount, balance_after, reason)
  values (new.id, 9, 9, 'signup_bonus');

  -- Add any credits bought through a Payment Link before signing up.
  if new.email is not null then
    for r in
      select * from public.pending_credit_purchases
       where lower(email) = lower(new.email)
         and claimed_at is null
       order by created_at
       for update
    loop
      v_balance := v_balance + r.credits;

      update public.profiles set credits = credits + r.credits where user_id = new.id;

      insert into public.credit_transactions (user_id, amount, balance_after, reason, stripe_session_id)
      values (new.id, r.credits, v_balance, 'purchase', r.stripe_session_id)
      on conflict (stripe_session_id) do nothing;

      update public.pending_credit_purchases
         set claimed_by = new.id, claimed_at = now()
       where id = r.id;
    end loop;
  end if;

  return new;
end;
$$;

-- #####################################################################
-- ## 006_multi_link_and_15_credits.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: several links per chat + 15 free credits (run after 001–005)
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

-- Links sent together share a group_id so they show up as one chat.
alter table public.analyses add column if not exists group_id uuid;
create index if not exists analyses_user_group_idx on public.analyses (user_id, group_id);

-- 15 free credits for new accounts (existing balances are unchanged).
alter table public.profiles alter column credits set default 15;

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id and credits <= 15);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric := 15;
  r record;
begin
  insert into public.profiles (user_id, email, credits)
  values (new.id, new.email, 15)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (user_id, amount, balance_after, reason)
  values (new.id, 15, 15, 'signup_bonus');

  -- Add any credits bought through a Payment Link before signing up.
  if new.email is not null then
    for r in
      select * from public.pending_credit_purchases
       where lower(email) = lower(new.email)
         and claimed_at is null
       order by created_at
       for update
    loop
      v_balance := v_balance + r.credits;

      update public.profiles set credits = credits + r.credits where user_id = new.id;

      insert into public.credit_transactions (user_id, amount, balance_after, reason, stripe_session_id)
      values (new.id, r.credits, v_balance, 'purchase', r.stripe_session_id)
      on conflict (stripe_session_id) do nothing;

      update public.pending_credit_purchases
         set claimed_by = new.id, claimed_at = now()
       where id = r.id;
    end loop;
  end if;

  return new;
end;
$$;

-- #####################################################################
-- ## 007_vouchers.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: voucher codes (run after 001–006)
-- Supabase > SQL Editor > New query > paste > Run.
-- Then run 008_generate_1000_vouchers.sql to create the codes.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Voucher codes ----------
create table if not exists public.promo_codes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  credits      integer not null default 100 check (credits > 0),
  redeemed     boolean not null default false,
  redeemed_by  uuid references auth.users(id) on delete set null,
  redeemed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists promo_codes_unredeemed_idx on public.promo_codes (code) where redeemed = false;

-- Locked down: RLS on with NO policies, plus no table rights for app users.
-- Only the server (service role) can read or change codes.
alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;

-- ---------- Failed-attempt log (brute-force protection) ----------
create table if not exists public.voucher_attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  success     boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists voucher_attempts_user_idx on public.voucher_attempts (user_id, created_at desc);
alter table public.voucher_attempts enable row level security;
revoke all on public.voucher_attempts from anon, authenticated;

-- ---------- Credit ledger: allow voucher entries ----------
alter table public.credit_transactions drop constraint if exists credit_transactions_reason_check;
alter table public.credit_transactions
  add constraint credit_transactions_reason_check
  check (reason in ('signup_bonus', 'analysis', 'follow_up', 'purchase', 'refund', 'voucher'));
alter table public.credit_transactions
  add column if not exists promo_code_id uuid references public.promo_codes(id) on delete set null;

-- ---------- Secure random code: RM-XXXX-YYYY ----------
-- 32-letter alphabet without look-alikes (no 0, O, 1, I). 32^8 ≈ 1.1 trillion combinations.
create or replace function public.make_promo_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(8);
  result text := 'RM-';
  i int;
begin
  for i in 0..7 loop
    if i = 4 then
      result := result || '-';
    end if;
    -- 256 is a multiple of 32, so every letter is equally likely.
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

-- ---------- Redeem: one atomic step ----------
-- Marks the code used and adds the credits in a single transaction.
-- The row lock on the code means two simultaneous attempts can never both succeed.
create or replace function public.redeem_promo_code(p_user_id uuid, p_code text)
returns table (status text, credits_added numeric, new_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_code text;
  v_promo_id uuid;
  v_promo_credits integer;
  v_balance numeric;
  v_failures int;
begin
  -- Accept "RM-ABCD-EFGH", "rm abcd efgh" or "RMABCDEFGH".
  if v_raw like 'RM%' then
    v_raw := substr(v_raw, 3);
  end if;
  v_code := 'RM-' || substr(v_raw, 1, 4) || '-' || substr(v_raw, 5);

  -- Brute-force protection: max 10 wrong codes per account per hour.
  select count(*) into v_failures
    from public.voucher_attempts
   where user_id = p_user_id
     and success = false
     and created_at > now() - interval '1 hour';
  if v_failures >= 10 then
    return query select 'rate_limited'::text, 0::numeric, null::numeric;
    return;
  end if;

  -- 1. Claim the code (only if it exists and is unused). Auto-discards it.
  update public.promo_codes
     set redeemed = true,
         redeemed_by = p_user_id,
         redeemed_at = now()
   where code = v_code
     and redeemed = false
  returning id, promo_codes.credits into v_promo_id, v_promo_credits;

  if v_promo_id is null then
    insert into public.voucher_attempts (user_id, success) values (p_user_id, false);
    return query select 'invalid'::text, 0::numeric, null::numeric;
    return;
  end if;

  -- 2–4. Add the credits in place (no read-then-write race).
  update public.profiles
     set credits = credits + v_promo_credits
   where user_id = p_user_id
  returning profiles.credits into v_balance;

  if v_balance is null then
    -- No profile: undo everything, including claiming the code.
    raise exception 'profile not found for user %', p_user_id;
  end if;

  insert into public.credit_transactions (user_id, amount, balance_after, reason, promo_code_id)
  values (p_user_id, v_promo_credits, v_balance, 'voucher', v_promo_id);

  insert into public.voucher_attempts (user_id, success) values (p_user_id, true);

  return query select 'ok'::text, v_promo_credits::numeric, v_balance;
end;
$$;

revoke all on function public.redeem_promo_code(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_promo_code(uuid, text) to service_role;
revoke all on function public.make_promo_code() from public, anon, authenticated;

-- #####################################################################
-- ## 008_generate_1000_vouchers.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: create 1,000 single-use vouchers (100 credits each)
-- Run AFTER 007_vouchers.sql. Safe to run again: each run adds 1,000 more.
-- =====================================================================

do $$
declare
  inserted int := 0;
begin
  if (select count(*) from public.promo_codes where code like 'RM-%') >= 1000 then
    return;
  end if;
  while inserted < 1000 loop
    insert into public.promo_codes (code, credits, redeemed)
    values (public.make_promo_code(), 100, false)
    on conflict (code) do nothing;   -- in the rare case of a duplicate, try again
    if found then
      inserted := inserted + 1;
    end if;
  end loop;
end;
$$;


-- #####################################################################
-- ## 009_voucher_orders.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: buy voucher codes by pack (run after 001–008)
-- Each paid order issues ONE voucher worth that pack's credits:
--   Starter 30 · Core 100 · Pro 250 · Elite 500 · Apex 1000
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

alter table public.promo_codes add column if not exists pack text;
alter table public.promo_codes add column if not exists purchased_by uuid references auth.users(id) on delete set null;

create table if not exists public.voucher_orders (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  pack               text not null check (pack in ('starter', 'core', 'pro', 'elite', 'apex')),
  credits            integer not null check (credits > 0),
  amount_cents       integer not null check (amount_cents > 0),
  currency           text not null default 'eur',
  payment_intent_id  text not null unique,
  status             text not null default 'pending' check (status in ('pending', 'paid')),
  promo_code_id      uuid references public.promo_codes(id) on delete set null,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists voucher_orders_user_idx on public.voucher_orders (user_id, created_at desc);

drop trigger if exists voucher_orders_updated_at on public.voucher_orders;
create trigger voucher_orders_updated_at before update on public.voucher_orders
  for each row execute function public.set_updated_at();

-- Server only (the app reads orders through /api/my-vouchers).
alter table public.voucher_orders enable row level security;
revoke all on public.voucher_orders from anon, authenticated;

-- Issues the voucher for a payment Stripe has confirmed. Safe to call many times:
-- the first call creates the code, later calls return the same code.
create or replace function public.issue_voucher_for_payment(
  p_payment_intent_id text,
  p_user_id uuid,
  p_pack text,
  p_credits integer,
  p_amount_cents integer,
  p_currency text
)
returns table (voucher_code text, voucher_credits integer, voucher_pack text, newly_issued boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.voucher_orders%rowtype;
  v_code text;
  v_promo_id uuid;
begin
  insert into public.voucher_orders (user_id, pack, credits, amount_cents, currency, payment_intent_id)
  values (p_user_id, p_pack, p_credits, p_amount_cents, lower(p_currency), p_payment_intent_id)
  on conflict (payment_intent_id) do nothing;

  -- Lock the order so two confirmations can't both issue a code.
  select * into v_order from public.voucher_orders where payment_intent_id = p_payment_intent_id for update;

  if v_order.user_id <> p_user_id then
    raise exception 'order % belongs to a different account', p_payment_intent_id;
  end if;

  if v_order.promo_code_id is not null then
    return query
      select pc.code, pc.credits, v_order.pack, false
        from public.promo_codes pc
       where pc.id = v_order.promo_code_id;
    return;
  end if;

  loop
    v_code := public.make_promo_code();
    insert into public.promo_codes (code, credits, pack, purchased_by)
    values (v_code, v_order.credits, v_order.pack, p_user_id)
    on conflict (code) do nothing
    returning id into v_promo_id;
    exit when v_promo_id is not null;
  end loop;

  update public.voucher_orders
     set status = 'paid', promo_code_id = v_promo_id, paid_at = now()
   where id = v_order.id;

  return query select v_code, v_order.credits, v_order.pack, true;
end;
$$;

revoke all on function public.issue_voucher_for_payment(text, uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.issue_voucher_for_payment(text, uuid, text, integer, integer, text) to service_role;

-- #####################################################################
-- ## 010_payment_verification_and_terms.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: payment verification in the database + terms acceptance
-- (run after 001–009)
--
-- After this, Supabase itself refuses to create a purchased voucher unless:
--   • a payment confirmed by Stripe is recorded in `payments`,
--   • it belongs to the same account,
--   • it's in euros, and
--   • the amount received covers the pack price in `credit_packs`.
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

-- ---------- The price list, kept in the database ----------
create table if not exists public.credit_packs (
  pack         text primary key,
  credits      integer not null check (credits > 0),
  price_cents  integer not null check (price_cents > 0),
  currency     text not null default 'eur',
  active       boolean not null default true
);

insert into public.credit_packs (pack, credits, price_cents) values
  ('starter',   30,  500),
  ('core',     100, 1000),
  ('pro',      250, 2000),
  ('elite',    500, 3000),
  ('apex',    1000, 4000)
on conflict (pack) do update
  set credits = excluded.credits, price_cents = excluded.price_cents, currency = excluded.currency;

alter table public.credit_packs enable row level security;
revoke all on public.credit_packs from anon, authenticated;

-- ---------- Every payment Stripe has confirmed ----------
create table if not exists public.payments (
  id                     uuid primary key default gen_random_uuid(),
  payment_intent_id      text not null unique,
  user_id                uuid references auth.users(id) on delete set null,
  pack                   text references public.credit_packs(pack),
  amount_cents           integer not null,
  amount_received_cents  integer not null default 0,
  currency               text not null,
  status                 text not null,
  verified_by            text not null check (verified_by in ('stripe_webhook', 'stripe_api')),
  stripe_event_id        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;

-- ---------- Terms accepted with each order ----------
alter table public.voucher_orders add column if not exists terms_version text;
alter table public.voucher_orders add column if not exists terms_accepted_at timestamptz;

-- ---------- Record what Stripe says about a payment (server only) ----------
create or replace function public.record_stripe_payment(
  p_payment_intent_id text,
  p_user_id uuid,
  p_pack text,
  p_amount_cents integer,
  p_amount_received_cents integer,
  p_currency text,
  p_status text,
  p_source text,
  p_event_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payments (payment_intent_id, user_id, pack, amount_cents, amount_received_cents,
                               currency, status, verified_by, stripe_event_id)
  values (p_payment_intent_id, p_user_id,
          case when exists (select 1 from public.credit_packs where pack = p_pack) then p_pack end,
          p_amount_cents, coalesce(p_amount_received_cents, 0), lower(p_currency), p_status, p_source, p_event_id)
  on conflict (payment_intent_id) do update
    set status = case
                   -- a late, out-of-order update never downgrades a confirmed payment
                   when payments.status = 'succeeded' and excluded.status not in ('succeeded', 'refunded') then payments.status
                   else excluded.status
                 end,
        amount_received_cents = greatest(payments.amount_received_cents, excluded.amount_received_cents),
        verified_by = case when excluded.verified_by = 'stripe_webhook' then 'stripe_webhook' else payments.verified_by end,
        stripe_event_id = coalesce(excluded.stripe_event_id, payments.stripe_event_id);
end;
$$;

-- ---------- Issue a purchased voucher, only for a verified payment ----------
drop function if exists public.issue_voucher_for_payment(text, uuid, text, integer, integer, text);

create or replace function public.issue_voucher_for_payment(p_payment_intent_id text, p_user_id uuid)
returns table (status text, voucher_code text, voucher_credits integer, voucher_pack text, newly_issued boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
  v_pack public.credit_packs%rowtype;
  v_order public.voucher_orders%rowtype;
  v_code text;
  v_promo_id uuid;
begin
  -- Lock the payment record so two confirmations can't both issue a code.
  select * into v_pay from public.payments where payment_intent_id = p_payment_intent_id for update;

  if not found or v_pay.status <> 'succeeded' then
    return query select 'not_paid'::text, null::text, null::integer, null::text, false;
    return;
  end if;
  if v_pay.user_id is distinct from p_user_id then
    return query select 'wrong_account'::text, null::text, null::integer, null::text, false;
    return;
  end if;

  select * into v_pack from public.credit_packs where pack = v_pay.pack;
  if not found then
    return query select 'unknown_pack'::text, null::text, null::integer, null::text, false;
    return;
  end if;
  if v_pay.currency <> v_pack.currency or v_pay.amount_received_cents < v_pack.price_cents then
    return query select 'amount_mismatch'::text, null::text, null::integer, null::text, false;
    return;
  end if;

  insert into public.voucher_orders (user_id, pack, credits, amount_cents, currency, payment_intent_id)
  values (p_user_id, v_pack.pack, v_pack.credits, v_pay.amount_cents, v_pay.currency, p_payment_intent_id)
  on conflict (payment_intent_id) do nothing;
  select * into v_order from public.voucher_orders where payment_intent_id = p_payment_intent_id for update;

  if v_order.promo_code_id is not null then
    return query
      select 'ok'::text, pc.code, pc.credits, v_order.pack, false
        from public.promo_codes pc where pc.id = v_order.promo_code_id;
    return;
  end if;

  loop
    v_code := public.make_promo_code();
    insert into public.promo_codes (code, credits, pack, purchased_by)
    values (v_code, v_pack.credits, v_pack.pack, p_user_id)
    on conflict (code) do nothing
    returning id into v_promo_id;
    exit when v_promo_id is not null;
  end loop;

  update public.voucher_orders
     set status = 'paid', promo_code_id = v_promo_id, paid_at = now(), credits = v_pack.credits
   where id = v_order.id;

  return query select 'ok'::text, v_code, v_pack.credits, v_pack.pack, true;
end;
$$;

revoke all on function public.record_stripe_payment(text, uuid, text, integer, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.issue_voucher_for_payment(text, uuid) from public, anon, authenticated;
grant execute on function public.record_stripe_payment(text, uuid, text, integer, integer, text, text, text, text) to service_role;
grant execute on function public.issue_voucher_for_payment(text, uuid) to service_role;

-- #####################################################################
-- ## 011_bank_transfers.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: pay by bank transfer (IBAN) instead of card (run after 001–010)
--
-- How a voucher gets created:
--   1. The buyer creates an order and gets a unique payment reference (PAY-XXXX-XXXX).
--   2. They transfer the money to your IBAN with that reference.
--   3. You see the money in your bank and click "Confirm payment received" on the Admin page.
--   4. Supabase checks: you are an admin, the order is unpaid, the amount covers the pack price.
--      Only then does it record the payment and create the voucher code.
--
-- After running this, make yourself an admin (replace the email):
--   insert into public.app_admins (user_id) select id from auth.users where email = 'you@example.com';
-- =====================================================================

-- ---------- Who can confirm payments ----------
create table if not exists public.app_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

-- ---------- Orders: support bank transfers ----------
alter table public.voucher_orders alter column payment_intent_id drop not null;
alter table public.voucher_orders add column if not exists payment_method text not null default 'card';
alter table public.voucher_orders drop constraint if exists voucher_orders_payment_method_check;
alter table public.voucher_orders add constraint voucher_orders_payment_method_check
  check (payment_method in ('card', 'bank_transfer'));
alter table public.voucher_orders add column if not exists reference text unique;
alter table public.voucher_orders add column if not exists customer_sent_at timestamptz;
alter table public.voucher_orders add column if not exists amount_received_cents integer;
alter table public.voucher_orders add column if not exists confirmed_by uuid references auth.users(id) on delete set null;
alter table public.voucher_orders add column if not exists cancelled_at timestamptz;
alter table public.voucher_orders drop constraint if exists voucher_orders_status_check;
alter table public.voucher_orders add constraint voucher_orders_status_check
  check (status in ('pending', 'paid', 'cancelled'));
create index if not exists voucher_orders_open_idx on public.voucher_orders (status, created_at desc);

-- ---------- Payments: allow bank confirmations ----------
alter table public.payments drop constraint if exists payments_verified_by_check;
alter table public.payments add constraint payments_verified_by_check
  check (verified_by in ('stripe_webhook', 'stripe_api', 'bank_manual'));
alter table public.payments add column if not exists confirmed_by uuid references auth.users(id) on delete set null;

-- ---------- Payment reference: PAY-XXXX-XXXX ----------
create or replace function public.make_payment_reference()
returns text
language sql
volatile
set search_path = public
as $$
  select 'PAY-' || substr(code, 4)  -- reuse the secure voucher generator, swap the prefix
    from (select public.make_promo_code() as code) c;
$$;

-- ---------- 1. Buyer creates an order ----------
create or replace function public.create_bank_order(p_user_id uuid, p_pack text, p_terms_version text)
returns table (status text, order_id uuid, order_reference text, order_amount_cents integer, order_credits integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_pack public.credit_packs%rowtype;
  v_open int;
  v_id uuid;
  v_ref text;
begin
  select * into v_pack from public.credit_packs where pack = p_pack and active;
  if not found then
    return query select 'unknown_pack'::text, null::uuid, null::text, null::integer, null::integer;
    return;
  end if;

  -- Stop people flooding the admin list with unpaid orders.
  select count(*) into v_open
    from public.voucher_orders vo
   where vo.user_id = p_user_id and vo.status = 'pending' and vo.created_at > now() - interval '7 days';
  if v_open >= 5 then
    return query select 'too_many_open'::text, null::uuid, null::text, null::integer, null::integer;
    return;
  end if;

  loop
    v_ref := public.make_payment_reference();
    insert into public.voucher_orders (user_id, pack, credits, amount_cents, currency, payment_method,
                                       reference, status, terms_version, terms_accepted_at)
    values (p_user_id, v_pack.pack, v_pack.credits, v_pack.price_cents, v_pack.currency, 'bank_transfer',
            v_ref, 'pending', p_terms_version, now())
    on conflict (reference) do nothing
    returning id into v_id;
    exit when v_id is not null;
  end loop;

  return query select 'ok'::text, v_id, v_ref, v_pack.price_cents, v_pack.credits;
end;
$$;

-- ---------- 2. Buyer says "I've sent the payment" ----------
create or replace function public.mark_bank_order_sent(p_user_id uuid, p_order_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.voucher_orders
       set customer_sent_at = coalesce(customer_sent_at, now())
     where id = p_order_id and user_id = p_user_id and status = 'pending' and payment_method = 'bank_transfer'
    returning 1
  )
  select exists (select 1 from updated);
$$;

-- ---------- 3. You confirm the money arrived (admins only) ----------
create or replace function public.confirm_bank_transfer(p_admin_id uuid, p_order_id uuid, p_amount_received_cents integer)
returns table (status text, voucher_code text, voucher_credits integer, voucher_pack text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_order public.voucher_orders%rowtype;
  v_pack public.credit_packs%rowtype;
  v_code text;
  v_promo_id uuid;
begin
  if not exists (select 1 from public.app_admins where user_id = p_admin_id) then
    return query select 'not_admin'::text, null::text, null::integer, null::text;
    return;
  end if;

  -- Lock the order so it can't be confirmed twice at the same moment.
  select * into v_order from public.voucher_orders
   where id = p_order_id and payment_method = 'bank_transfer'
   for update;
  if not found then
    return query select 'not_found'::text, null::text, null::integer, null::text;
    return;
  end if;

  if v_order.status = 'paid' then
    return query select 'already_paid'::text, pc.code, pc.credits, v_order.pack
      from public.promo_codes pc where pc.id = v_order.promo_code_id;
    return;
  end if;

  select * into v_pack from public.credit_packs where pack = v_order.pack;
  if p_amount_received_cents is null or p_amount_received_cents < v_pack.price_cents then
    return query select 'amount_too_low'::text, null::text, null::integer, null::text;
    return;
  end if;

  -- Record the payment (the proof Supabase checks), then create the code.
  insert into public.payments (payment_intent_id, user_id, pack, amount_cents, amount_received_cents,
                               currency, status, verified_by, confirmed_by)
  values ('bank:' || v_order.reference, v_order.user_id, v_order.pack, v_pack.price_cents,
          p_amount_received_cents, v_pack.currency, 'succeeded', 'bank_manual', p_admin_id)
  on conflict (payment_intent_id) do nothing;

  loop
    v_code := public.make_promo_code();
    insert into public.promo_codes (code, credits, pack, purchased_by)
    values (v_code, v_pack.credits, v_pack.pack, v_order.user_id)
    on conflict (code) do nothing
    returning id into v_promo_id;
    exit when v_promo_id is not null;
  end loop;

  update public.voucher_orders
     set status = 'paid', promo_code_id = v_promo_id, paid_at = now(),
         amount_received_cents = p_amount_received_cents, confirmed_by = p_admin_id,
         credits = v_pack.credits, cancelled_at = null
   where id = v_order.id;

  return query select 'ok'::text, v_code, v_pack.credits, v_pack.pack;
end;
$$;

-- ---------- Cancel an order that was never paid (admins only) ----------
create or replace function public.cancel_bank_order(p_admin_id uuid, p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.app_admins where user_id = p_admin_id) then
    return 'not_admin';
  end if;
  update public.voucher_orders set status = 'cancelled', cancelled_at = now()
   where id = p_order_id and status = 'pending' and payment_method = 'bank_transfer';
  return case when found then 'ok' else 'not_found' end;
end;
$$;

revoke all on function public.make_payment_reference() from public, anon, authenticated;
revoke all on function public.create_bank_order(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mark_bank_order_sent(uuid, uuid) from public, anon, authenticated;
revoke all on function public.confirm_bank_transfer(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.cancel_bank_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_bank_order(uuid, text, text) to service_role;
grant execute on function public.mark_bank_order_sent(uuid, uuid) to service_role;
grant execute on function public.confirm_bank_transfer(uuid, uuid, integer) to service_role;
grant execute on function public.cancel_bank_order(uuid, uuid) to service_role;

-- #####################################################################
-- ## 012_stripe_checkout.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: checkout with card, Apple Pay, Google Pay and SEPA Direct Debit
-- (run after 001–011)
--
-- Flow:
--   1. create_stripe_order: the buyer starts checkout (price taken from credit_packs).
--   2. Stripe confirms the payment; the server records it in `payments`
--      (from Stripe's signed webhook, or by asking Stripe directly).
--   3. fulfill_stripe_order: Supabase checks the recorded payment (confirmed, same account,
--      euros, full pack price), then creates the code and, unless it's a gift, adds the
--      credits to the buyer's account straight away. It also gives the order a receipt number.
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

alter table public.voucher_orders drop constraint if exists voucher_orders_payment_method_check;
alter table public.voucher_orders add constraint voucher_orders_payment_method_check
  check (payment_method in ('card', 'bank_transfer', 'stripe'));

alter table public.voucher_orders drop constraint if exists voucher_orders_status_check;
alter table public.voucher_orders add constraint voucher_orders_status_check
  check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled'));

alter table public.voucher_orders add column if not exists gift boolean not null default false;
alter table public.voucher_orders add column if not exists receipt_number text unique;
alter table public.voucher_orders add column if not exists payment_method_label text;
alter table public.voucher_orders add column if not exists payer_name text;
alter table public.voucher_orders add column if not exists failure_message text;

create sequence if not exists public.receipt_number_seq;

-- ---------- 1. Start an order (price comes from the database) ----------
create or replace function public.create_stripe_order(p_user_id uuid, p_pack text, p_gift boolean, p_terms_version text)
returns table (status text, order_id uuid, order_amount_cents integer, order_credits integer, order_currency text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_pack public.credit_packs%rowtype;
  v_id uuid;
begin
  select * into v_pack from public.credit_packs where pack = p_pack and active;
  if not found then
    return query select 'unknown_pack'::text, null::uuid, null::integer, null::integer, null::text;
    return;
  end if;

  insert into public.voucher_orders (user_id, pack, credits, amount_cents, currency, payment_method,
                                     status, gift, terms_version, terms_accepted_at)
  values (p_user_id, v_pack.pack, v_pack.credits, v_pack.price_cents, v_pack.currency, 'stripe',
          'pending', coalesce(p_gift, false), p_terms_version, now())
  returning id into v_id;

  return query select 'ok'::text, v_id, v_pack.price_cents, v_pack.credits, v_pack.currency;
end;
$$;

-- ---------- 3. Fulfil a paid order (only for a verified payment) ----------
create or replace function public.fulfill_stripe_order(p_payment_intent_id text, p_method_label text, p_payer_name text)
returns table (status text, voucher_code text, voucher_credits integer, voucher_pack text,
               is_gift boolean, new_balance numeric, newly_fulfilled boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_order public.voucher_orders%rowtype;
  v_pay public.payments%rowtype;
  v_pack public.credit_packs%rowtype;
  v_code text;
  v_promo_id uuid;
  v_balance numeric;
  v_receipt text;
begin
  -- Lock the order so the webhook and the waiting page can't both fulfil it.
  select * into v_order from public.voucher_orders where payment_intent_id = p_payment_intent_id for update;
  if not found then
    return query select 'no_order'::text, null::text, null::integer, null::text, null::boolean, null::numeric, false;
    return;
  end if;

  if v_order.promo_code_id is not null then
    return query
      select 'ok'::text, pc.code, pc.credits, v_order.pack, v_order.gift, null::numeric, false
        from public.promo_codes pc where pc.id = v_order.promo_code_id;
    return;
  end if;

  select * into v_pay from public.payments where payment_intent_id = p_payment_intent_id;
  if not found or v_pay.status <> 'succeeded' then
    return query select 'not_paid'::text, null::text, null::integer, null::text, null::boolean, null::numeric, false;
    return;
  end if;
  if v_pay.user_id is distinct from v_order.user_id then
    return query select 'wrong_account'::text, null::text, null::integer, null::text, null::boolean, null::numeric, false;
    return;
  end if;

  select * into v_pack from public.credit_packs where pack = v_order.pack;
  if v_pay.pack is distinct from v_order.pack
     or v_pay.currency <> v_pack.currency
     or v_pay.amount_received_cents < v_pack.price_cents then
    return query select 'amount_mismatch'::text, null::text, null::integer, null::text, null::boolean, null::numeric, false;
    return;
  end if;

  -- Create the code. If it isn't a gift, it's used on the buyer's own account right away.
  loop
    v_code := public.make_promo_code();
    insert into public.promo_codes (code, credits, pack, purchased_by, redeemed, redeemed_by, redeemed_at)
    values (v_code, v_pack.credits, v_pack.pack, v_order.user_id,
            not v_order.gift,
            case when v_order.gift then null else v_order.user_id end,
            case when v_order.gift then null else now() end)
    on conflict (code) do nothing
    returning id into v_promo_id;
    exit when v_promo_id is not null;
  end loop;

  if not v_order.gift then
    update public.profiles set credits = credits + v_pack.credits
     where user_id = v_order.user_id
    returning credits into v_balance;
    if v_balance is null then
      raise exception 'profile not found for user %', v_order.user_id;  -- undoes everything above
    end if;
    insert into public.credit_transactions (user_id, amount, balance_after, reason, promo_code_id)
    values (v_order.user_id, v_pack.credits, v_balance, 'purchase', v_promo_id);
  end if;

  v_receipt := 'R' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(nextval('public.receipt_number_seq')::text, 6, '0');

  update public.voucher_orders
     set status = 'paid', promo_code_id = v_promo_id, paid_at = now(), credits = v_pack.credits,
         amount_received_cents = v_pay.amount_received_cents, receipt_number = v_receipt,
         payment_method_label = coalesce(p_method_label, payment_method_label),
         payer_name = coalesce(p_payer_name, payer_name), failure_message = null
   where id = v_order.id;

  return query select 'ok'::text, v_code, v_pack.credits, v_pack.pack, v_order.gift, v_balance, true;
end;
$$;

revoke all on function public.create_stripe_order(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.fulfill_stripe_order(text, text, text) from public, anon, authenticated;
grant execute on function public.create_stripe_order(uuid, text, boolean, text) to service_role;
grant execute on function public.fulfill_stripe_order(text, text, text) to service_role;

-- #####################################################################
-- ## 013_tiers.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: account tiers + vouchers that grant custom credits and tiers
-- (run after 001–012)
--
--   • profiles.tier: Free, Starter, Core, Pro, Elite or Apex (starts as Free)
--   • promo_codes.tier: the tier a code unlocks (empty = credits only)
--   • Redeeming adds the code's credits and upgrades the tier. Tiers only ever go UP:
--     an Apex member who redeems a Core code keeps Apex and still gets the credits.
--   • Buying a pack upgrades the buyer to that pack's tier; gift codes carry it too.
--   • Brute-force protection: 10 wrong codes per account AND 30 per internet
--     connection (IP address) per hour.
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

-- ---------- Tiers ----------
create or replace function public.tier_rank(p_tier text)
returns integer
language sql
immutable
as $$
  select case p_tier
    when 'Free' then 0 when 'Starter' then 1 when 'Core' then 2
    when 'Pro' then 3 when 'Elite' then 4 when 'Apex' then 5
    else -1 end;
$$;

alter table public.profiles add column if not exists tier text not null default 'Free';
alter table public.profiles drop constraint if exists profiles_tier_check;
alter table public.profiles add constraint profiles_tier_check
  check (tier in ('Free', 'Starter', 'Core', 'Pro', 'Elite', 'Apex'));

alter table public.promo_codes add column if not exists tier text;
alter table public.promo_codes drop constraint if exists promo_codes_tier_check;
alter table public.promo_codes add constraint promo_codes_tier_check
  check (tier is null or tier in ('Starter', 'Core', 'Pro', 'Elite', 'Apex'));

-- People can never give themselves a tier or credits: new profiles must start Free.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id and credits <= 15 and tier = 'Free');
-- (There is still no UPDATE policy on profiles, so balances and tiers only change through the functions below.)

-- ---------- Brute-force protection per connection ----------
alter table public.voucher_attempts add column if not exists ip text;
create index if not exists voucher_attempts_ip_idx on public.voucher_attempts (ip, created_at desc);

-- ---------- Redeem: credits + tier, in one atomic step ----------
drop function if exists public.redeem_promo_code(uuid, text);
drop function if exists public.redeem_promo_code(uuid, text, text);

create function public.redeem_promo_code(p_user_id uuid, p_code text, p_ip text default null)
returns table (status text, credits_added numeric, new_balance numeric, new_tier text, tier_upgraded boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_promo_id uuid;
  v_credits integer;
  v_code_tier text;
  v_old_tier text;
  v_balance numeric;
  v_tier text;
begin
  -- Old-style codes typed without dashes: RMABCDEFGH → RM-ABCD-EFGH
  if v_code ~ '^RM[A-Z0-9]{8}$' then
    v_code := 'RM-' || substr(v_code, 3, 4) || '-' || substr(v_code, 7, 4);
  end if;

  -- Brute-force protection.
  if (select count(*) from public.voucher_attempts va
       where va.user_id = p_user_id and not va.success and va.created_at > now() - interval '1 hour') >= 10
     or (p_ip is not null and (select count(*) from public.voucher_attempts va
       where va.ip = p_ip and not va.success and va.created_at > now() - interval '1 hour') >= 30) then
    return query select 'rate_limited'::text, 0::numeric, null::numeric, null::text, false;
    return;
  end if;

  -- a–c. Claim the code: only if it exists and hasn't been used. The row lock means it can only ever be used once.
  update public.promo_codes pc
     set redeemed = true, redeemed_by = p_user_id, redeemed_at = now()
   where pc.code = v_code and pc.redeemed = false
  returning pc.id, pc.credits, pc.tier into v_promo_id, v_credits, v_code_tier;

  if v_promo_id is null then
    insert into public.voucher_attempts (user_id, success, ip) values (p_user_id, false, p_ip);
    return query select 'invalid'::text, 0::numeric, null::numeric, null::text, false;
    return;
  end if;

  -- d. Add the credits and upgrade the tier (never downgrade).
  select pr.tier into v_old_tier from public.profiles pr where pr.user_id = p_user_id for update;
  if v_old_tier is null then
    raise exception 'profile not found for user %', p_user_id;  -- undoes the claim above
  end if;

  update public.profiles pr
     set credits = pr.credits + v_credits,
         tier = case when v_code_tier is not null and public.tier_rank(v_code_tier) > public.tier_rank(pr.tier)
                     then v_code_tier else pr.tier end
   where pr.user_id = p_user_id
  returning pr.credits, pr.tier into v_balance, v_tier;

  insert into public.credit_transactions (user_id, amount, balance_after, reason, promo_code_id)
  values (p_user_id, v_credits, v_balance, 'voucher', v_promo_id);
  insert into public.voucher_attempts (user_id, success, ip) values (p_user_id, true, p_ip);

  -- e. New balance and tier.
  return query select 'ok'::text, v_credits::numeric, v_balance, v_tier, v_tier is distinct from v_old_tier;
end;
$$;

revoke all on function public.redeem_promo_code(uuid, text, text) from public, anon, authenticated;
grant execute on function public.redeem_promo_code(uuid, text, text) to service_role;

-- ---------- Purchases: codes carry the pack's tier; buyers are upgraded ----------
create or replace function public.fulfill_stripe_order(p_payment_intent_id text, p_method_label text, p_payer_name text)
returns table (status text, voucher_code text, voucher_credits integer, voucher_pack text,
               is_gift boolean, new_balance numeric, newly_fulfilled boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_order public.voucher_orders%rowtype;
  v_pay public.payments%rowtype;
  v_pack public.credit_packs%rowtype;
  v_code text;
  v_promo_id uuid;
  v_balance numeric;
  v_receipt text;
begin
  -- Lock the order so the webhook and the waiting page can't both fulfil it.
  select * into v_order from public.voucher_orders where payment_intent_id = p_payment_intent_id for update;
  if not found then
    return query select 'no_order'::text, null::text, null::integer, null::text, null::boolean, null::numeric, false;
    return;
  end if;

  if v_order.promo_code_id is not null then
    return query
      select 'ok'::text, pc.code, pc.credits, v_order.pack, v_order.gift, null::numeric, false
        from public.promo_codes pc where pc.id = v_order.promo_code_id;
    return;
  end if;

  select * into v_pay from public.payments where payment_intent_id = p_payment_intent_id;
  if not found or v_pay.status <> 'succeeded' then
    return query select 'not_paid'::text, null::text, null::integer, null::text, null::boolean, null::numeric, false;
    return;
  end if;
  if v_pay.user_id is distinct from v_order.user_id then
    return query select 'wrong_account'::text, null::text, null::integer, null::text, null::boolean, null::numeric, false;
    return;
  end if;

  select * into v_pack from public.credit_packs where pack = v_order.pack;
  if v_pay.pack is distinct from v_order.pack
     or v_pay.currency <> v_pack.currency
     or v_pay.amount_received_cents < v_pack.price_cents then
    return query select 'amount_mismatch'::text, null::text, null::integer, null::text, null::boolean, null::numeric, false;
    return;
  end if;

  -- Create the code. If it isn't a gift, it's used on the buyer's own account right away.
  loop
    v_code := public.make_promo_code();
    insert into public.promo_codes (code, credits, tier, pack, purchased_by, redeemed, redeemed_by, redeemed_at)
    values (v_code, v_pack.credits, initcap(v_pack.pack), v_pack.pack, v_order.user_id,
            not v_order.gift,
            case when v_order.gift then null else v_order.user_id end,
            case when v_order.gift then null else now() end)
    on conflict (code) do nothing
    returning id into v_promo_id;
    exit when v_promo_id is not null;
  end loop;

  if not v_order.gift then
    update public.profiles
       set credits = credits + v_pack.credits,
           tier = case when public.tier_rank(initcap(v_pack.pack)) > public.tier_rank(tier) then initcap(v_pack.pack) else tier end
     where user_id = v_order.user_id
    returning credits into v_balance;
    if v_balance is null then
      raise exception 'profile not found for user %', v_order.user_id;  -- undoes everything above
    end if;
    insert into public.credit_transactions (user_id, amount, balance_after, reason, promo_code_id)
    values (v_order.user_id, v_pack.credits, v_balance, 'purchase', v_promo_id);
  end if;

  v_receipt := 'R' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(nextval('public.receipt_number_seq')::text, 6, '0');

  update public.voucher_orders
     set status = 'paid', promo_code_id = v_promo_id, paid_at = now(), credits = v_pack.credits,
         amount_received_cents = v_pay.amount_received_cents, receipt_number = v_receipt,
         payment_method_label = coalesce(p_method_label, payment_method_label),
         payer_name = coalesce(p_payer_name, payer_name), failure_message = null
   where id = v_order.id;

  return query select 'ok'::text, v_code, v_pack.credits, v_pack.pack, v_order.gift, v_balance, true;
end;
$$;

revoke all on function public.fulfill_stripe_order(text, text, text) from public, anon, authenticated;
grant execute on function public.fulfill_stripe_order(text, text, text) to service_role;

-- #####################################################################
-- ## 014_generate_100_apex_codes.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: create 100 Apex vouchers (1000 credits + Apex tier each)
-- Run AFTER 013_tiers.sql. Each run adds 100 more.
--
-- Format: APEX-1000-XXXX-XXXX. The 8 random characters come from a secure random
-- generator and a 32-letter alphabet (no 0/O or 1/I): over 1 trillion possibilities,
-- so codes can't be guessed.
-- =====================================================================

do $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  inserted int := 0;
  bytes bytea;
  part text;
  i int;
begin
  if (select count(*) from public.promo_codes where code like 'APEX-1000-%') >= 100 then
    return;
  end if;
  while inserted < 100 loop
    bytes := gen_random_bytes(8);
    part := '';
    for i in 0..7 loop
      if i = 4 then
        part := part || '-';
      end if;
      part := part || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;

    insert into public.promo_codes (code, credits, tier, redeemed)
    values ('APEX-1000-' || part, 1000, 'Apex', false)
    on conflict (code) do nothing;      -- in the rare case of a duplicate, try again

    if found then
      inserted := inserted + 1;
    end if;
  end loop;
end;
$$;


-- #####################################################################
-- ## 015_purchases_give_codes.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: every purchase gives a voucher code (run after 001–014)
--
-- Buying a pack no longer adds credits to the buyer's account by itself.
-- Once the payment is confirmed, Supabase creates ONE unused voucher code worth the
-- pack's credits and tier. The buyer (or anyone they give it to) redeems it to get
-- the credits and the tier upgrade.
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

create or replace function public.create_stripe_order(p_user_id uuid, p_pack text, p_gift boolean, p_terms_version text)
returns table (status text, order_id uuid, order_amount_cents integer, order_credits integer, order_currency text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_pack public.credit_packs%rowtype;
  v_id uuid;
begin
  select * into v_pack from public.credit_packs where pack = p_pack and active;
  if not found then
    return query select 'unknown_pack'::text, null::uuid, null::integer, null::integer, null::text;
    return;
  end if;

  -- gift = true: the order is delivered as an unused voucher code (p_gift is ignored).
  insert into public.voucher_orders (user_id, pack, credits, amount_cents, currency, payment_method,
                                     status, gift, terms_version, terms_accepted_at)
  values (p_user_id, v_pack.pack, v_pack.credits, v_pack.price_cents, v_pack.currency, 'stripe',
          'pending', true, p_terms_version, now())
  returning id into v_id;

  return query select 'ok'::text, v_id, v_pack.price_cents, v_pack.credits, v_pack.currency;
end;
$$;

revoke all on function public.create_stripe_order(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.create_stripe_order(uuid, text, boolean, text) to service_role;

-- #####################################################################
-- ## 016_stripe_hosted_checkout.sql
-- #####################################################################

-- =====================================================================
-- Review Miner: Stripe-hosted checkout that adds credits directly (run after 001–015)
--
--   • "Get Starter" (etc.) opens Stripe's own checkout page.
--   • After Stripe confirms the money, Supabase verifies it and adds the pack's credits
--     and tier straight to the buyer's account. No code to redeem.
--   • Voucher codes still work as before, for promotions and giveaways.
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

alter table public.voucher_orders add column if not exists checkout_session_id text unique;

-- Respect p_gift again: purchases (p_gift = false) add credits directly.
create or replace function public.create_stripe_order(p_user_id uuid, p_pack text, p_gift boolean, p_terms_version text)
returns table (status text, order_id uuid, order_amount_cents integer, order_credits integer, order_currency text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_pack public.credit_packs%rowtype;
  v_id uuid;
begin
  select * into v_pack from public.credit_packs where pack = p_pack and active;
  if not found then
    return query select 'unknown_pack'::text, null::uuid, null::integer, null::integer, null::text;
    return;
  end if;

  insert into public.voucher_orders (user_id, pack, credits, amount_cents, currency, payment_method,
                                     status, gift, terms_version, terms_accepted_at)
  values (p_user_id, v_pack.pack, v_pack.credits, v_pack.price_cents, v_pack.currency, 'stripe',
          'pending', coalesce(p_gift, false), p_terms_version, now())
  returning id into v_id;

  return query select 'ok'::text, v_id, v_pack.price_cents, v_pack.credits, v_pack.currency;
end;
$$;

revoke all on function public.create_stripe_order(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.create_stripe_order(uuid, text, boolean, text) to service_role;

-- #####################################################################
-- ## 017_usage_admin_and_cancellation.sql
-- #####################################################################

-- =====================================================================
-- Review Miner 017: usage tracking, AI limits, admin tools, checkout cancellation
-- (run after 001–016; already included in 000_SETUP_ALL.sql)
--
--   • ai_usage: one row per AI request (tokens, web searches, outcome, credits)
--   • check_ai_rate_limit: per-user hourly/daily AI request limits
--   • admin_adjust_credits / admin_set_tier: admin-only, recorded in credit_transactions
--   • cancel_pending_order: the buyer cancels an unpaid checkout
-- =====================================================================

-- ---------- Ledger: admin adjustments with a note and who made them ----------
alter table public.credit_transactions add column if not exists note text;
alter table public.credit_transactions add column if not exists admin_id uuid references auth.users(id) on delete set null;
alter table public.credit_transactions drop constraint if exists credit_transactions_reason_check;
alter table public.credit_transactions
  add constraint credit_transactions_reason_check
  check (reason in ('signup_bonus', 'analysis', 'follow_up', 'purchase', 'refund', 'voucher', 'admin_adjustment'));
create index if not exists credit_transactions_created_idx on public.credit_transactions (created_at desc);

-- ---------- AI usage tracking ----------
create table if not exists public.ai_usage (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  endpoint         text not null check (endpoint in ('analyze', 'ask')),
  url              text,
  status           text not null check (status in ('ok', 'error', 'rejected')),
  error_code       text,
  model            text,
  input_tokens     integer not null default 0,
  output_tokens    integer not null default 0,
  web_searches     integer not null default 0,
  page_fetched     boolean,
  credits_charged  numeric(10,1) not null default 0,
  duration_ms      integer,
  created_at       timestamptz not null default now()
);
create index if not exists ai_usage_user_time_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_time_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only the server (service role) writes usage rows.

-- Requests that reached the AI (ok or error) count towards the limits; rejected ones don't.
create or replace function public.check_ai_rate_limit(p_user_id uuid, p_hourly integer, p_daily integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select count(*) from public.ai_usage
           where user_id = p_user_id and status <> 'rejected' and created_at > now() - interval '1 hour') >= p_hourly then 'hourly'
    when (select count(*) from public.ai_usage
           where user_id = p_user_id and status <> 'rejected' and created_at > now() - interval '1 day') >= p_daily then 'daily'
    else 'ok'
  end;
$$;

-- ---------- Admin: adjust a user's credits ----------
create or replace function public.admin_adjust_credits(p_admin_id uuid, p_user_id uuid, p_amount numeric, p_note text)
returns table (status text, new_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_balance numeric;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not exists (select 1 from public.app_admins a where a.user_id = p_admin_id) then
    return query select 'not_admin'::text, null::numeric;
    return;
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 or p_amount * 10 <> round(p_amount * 10) then
    return query select 'invalid_amount'::text, null::numeric;
    return;
  end if;
  if length(v_note) < 3 or length(v_note) > 300 then
    return query select 'note_required'::text, null::numeric;
    return;
  end if;

  select pr.credits into v_balance from public.profiles pr where pr.user_id = p_user_id for update;
  if not found then
    return query select 'no_user'::text, null::numeric;
    return;
  end if;
  if v_balance + p_amount < 0 then
    return query select 'insufficient'::text, v_balance;
    return;
  end if;

  update public.profiles pr set credits = pr.credits + p_amount where pr.user_id = p_user_id
  returning pr.credits into v_balance;

  insert into public.credit_transactions (user_id, amount, balance_after, reason, note, admin_id)
  values (p_user_id, p_amount, v_balance, 'admin_adjustment', v_note, p_admin_id);

  return query select 'ok'::text, v_balance;
end;
$$;

-- ---------- Admin: set a user's tier ----------
create or replace function public.admin_set_tier(p_admin_id uuid, p_user_id uuid, p_tier text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.app_admins a where a.user_id = p_admin_id) then
    return 'not_admin';
  end if;
  if p_tier is null or public.tier_rank(p_tier) < 0 then
    return 'invalid_tier';
  end if;
  update public.profiles set tier = p_tier where user_id = p_user_id;
  if not found then
    return 'no_user';
  end if;
  return 'ok';
end;
$$;

-- ---------- Buyer cancels an unpaid checkout ----------
create or replace function public.cancel_pending_order(p_user_id uuid, p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.voucher_orders
     set status = 'cancelled'
   where id = p_order_id and user_id = p_user_id and status = 'pending';
  if found then
    return 'ok';
  end if;
  return 'not_pending';
end;
$$;

revoke all on function public.check_ai_rate_limit(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_adjust_credits(uuid, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.admin_set_tier(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_pending_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.check_ai_rate_limit(uuid, integer, integer) to service_role;
grant execute on function public.admin_adjust_credits(uuid, uuid, numeric, text) to service_role;
grant execute on function public.admin_set_tier(uuid, uuid, text) to service_role;
grant execute on function public.cancel_pending_order(uuid, uuid) to service_role;

-- #####################################################################
-- ## Done. Summary:
-- #####################################################################
select
  (select count(*) from public.credit_packs)                                                as credit_packs,
  (select count(*) from public.promo_codes where code like 'RM-%' and not redeemed)        as unused_rm_codes,
  (select count(*) from public.promo_codes where code like 'APEX-1000-%' and not redeemed) as unused_apex_codes,
  (select count(*) from public.app_admins)                                                  as admins;
