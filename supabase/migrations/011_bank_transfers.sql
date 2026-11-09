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
