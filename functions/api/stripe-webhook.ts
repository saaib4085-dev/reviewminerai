// POST /api/stripe-webhook
// The background worker: Stripe calls this the moment a payment succeeds, is processing or fails.
// We check Stripe's signature, save the payment in Supabase, and Supabase verifies it and
// delivers the credits (or gift code). This also covers SEPA Direct Debits that confirm days later,
// when the buyer is no longer on the page.

import type { Env } from '../../server/env';
import { json } from '../../server/http';
import { serviceClient } from '../../server/supabase';
import { getPaymentIntent, verifyStripeSignature, type StripePaymentIntent } from '../../server/stripe';
import { recordPayment, syncOrder } from '../../server/fulfil';

interface StripeEvent {
  id: string;
  type: string;
  data: { object: StripePaymentIntent };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const payload = await request.text();
  const valid = await verifyStripeSignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return json({ error: 'Invalid signature' }, 400);

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return json({ error: 'Invalid payload' }, 400);
  }

  if (!event.type.startsWith('payment_intent.') || event.data.object.metadata?.kind !== 'voucher') {
    return json({ received: true });
  }

  try {
    // Fetch the latest state (with card/bank details for the receipt) instead of trusting event order.
    const pi = await getPaymentIntent(env, event.data.object.id);
    const db = serviceClient(env);
    await recordPayment(db, pi, 'stripe_webhook', event.id);
    await syncOrder(db, pi);
    return json({ received: true });
  } catch (err) {
    console.error('Webhook failed', event.id, err);
    return json({ error: 'Webhook failed' }, 500); // Stripe retries automatically.
  }
};
