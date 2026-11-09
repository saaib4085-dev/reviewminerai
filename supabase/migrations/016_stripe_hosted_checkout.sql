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
