// Shared by the Cloudflare functions (functions/api/…) and the Next.js routes (nextjs/app/api/…).
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { CREDIT_PACKS, TERMS_VERSION, type CheckoutStartRequest, type CheckoutStartResponse, type CheckoutStatusResponse, type PackId } from '../shared/types';
import type { Env } from './env';
import { HttpError } from './http';
import { checkPackPrice, createCheckoutSession, getCheckoutSession, getPaymentIntent, priceIdFor, type StripePaymentIntent } from './stripe';
import { recordPayment, syncOrder } from './fulfil';
import { ORDER_COLUMNS, toOrder } from './orders';

/**
 * 1. Supabase creates the order (price from its own credit_packs table).
 * 2. Safety check: the pack's Stripe price must match that price.
 * 3. Stripe creates its hosted checkout page; the buyer is sent there to pay and ticks the Terms there.
 */
export async function startCheckout(
  env: Env,
  db: SupabaseClient,
  user: User,
  body: Partial<CheckoutStartRequest>,
  origin: string,
): Promise<CheckoutStartResponse> {
  if (!body.pack || !Object.prototype.hasOwnProperty.call(CREDIT_PACKS, body.pack)) {
    throw new HttpError(400, 'BAD_PACK', 'Choose a credit pack.');
  }

  const { data, error } = await db.rpc('create_stripe_order', {
    p_user_id: user.id,
    p_pack: body.pack,
    p_gift: false, // purchases add credits straight to the buyer's account
    p_terms_version: TERMS_VERSION,
  });
  if (error) throw error;
  const order = (Array.isArray(data) ? data[0] : data) as {
    status: string;
    order_id: string;
    order_amount_cents: number;
    order_credits: number;
    order_currency: string;
  } | null;
  if (order?.status !== 'ok') throw new HttpError(400, 'BAD_PACK', 'That pack isn’t available.');

  const priceId = priceIdFor(env, body.pack as PackId);
  await checkPackPrice(env, priceId, order.order_amount_cents, order.order_currency);

  const session = await createCheckoutSession(env, {
    priceId,
    orderId: order.order_id,
    userId: user.id,
    email: user.email,
    pack: body.pack,
    credits: order.order_credits,
    origin,
  });
  if (!session.url) throw new Error('Stripe returned no checkout URL');

  const { error: linkError } = await db.from('voucher_orders').update({ checkout_session_id: session.id }).eq('id', order.order_id);
  if (linkError) throw linkError;

  return { orderId: order.order_id, url: session.url };
}

/**
 * Asks Stripe directly whether the order was paid (never trusting the browser), records the answer
 * in Supabase, and lets Supabase verify it and add the credits + tier.
 */
export async function verifyOrder(env: Env, db: SupabaseClient, user: User, orderId: string): Promise<CheckoutStatusResponse> {
  const load = async () => {
    const { data, error } = await db
      .from('voucher_orders')
      .select(`${ORDER_COLUMNS}, checkout_session_id`)
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, 'NOT_FOUND', 'Order not found.');
    const row = data as unknown as { payment_intent_id: string | null; checkout_session_id: string | null };
    return { row, order: toOrder(data) };
  };

  let { row, order } = await load();
  if (order.status === 'paid') return { status: 'paid', order, newCredits: null, message: null };

  let pi: StripePaymentIntent | null = null;
  let sessionStatus: string | null = null;
  if (row.checkout_session_id) {
    const session = await getCheckoutSession(env, row.checkout_session_id);
    if (session.metadata?.order_id !== orderId || session.metadata?.user_id !== user.id) {
      throw new HttpError(403, 'FORBIDDEN', 'This payment belongs to a different account.');
    }
    sessionStatus = session.status;
    if (session.payment_intent && typeof session.payment_intent === 'object') pi = session.payment_intent;
  } else if (row.payment_intent_id) {
    pi = await getPaymentIntent(env, row.payment_intent_id);
  }

  if (!pi) {
    // Not paid yet: still on Stripe's page, or the page expired.
    return sessionStatus === 'expired'
      ? { status: 'failed', order, newCredits: null, message: 'The checkout page expired before payment. You haven’t been charged.' }
      : { status: 'pending', order, newCredits: null, message: null };
  }
  if (pi.metadata?.user_id !== user.id || pi.metadata?.order_id !== orderId) {
    throw new HttpError(403, 'FORBIDDEN', 'This payment belongs to a different account.');
  }

  await recordPayment(db, pi, 'stripe_api');
  const { newCredits } = await syncOrder(db, pi);
  ({ order } = await load());

  let status: CheckoutStatusResponse['status'] = 'pending';
  if (order.status === 'paid') status = 'paid';
  else if (pi.status === 'processing') status = 'processing';
  else if (pi.status === 'requires_action' || pi.status === 'requires_confirmation') status = 'requires_action';
  else if (order.status === 'failed') status = 'failed';
  return { status, order, newCredits, message: order.failureMessage };
}
