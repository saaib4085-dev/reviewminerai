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
