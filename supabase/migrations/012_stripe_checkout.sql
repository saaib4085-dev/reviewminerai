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
