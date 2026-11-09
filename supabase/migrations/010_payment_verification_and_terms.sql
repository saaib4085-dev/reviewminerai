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
