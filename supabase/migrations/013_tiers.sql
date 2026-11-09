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
