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
