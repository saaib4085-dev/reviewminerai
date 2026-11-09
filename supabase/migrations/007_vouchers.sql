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
