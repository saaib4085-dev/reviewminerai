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
