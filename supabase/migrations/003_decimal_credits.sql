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
