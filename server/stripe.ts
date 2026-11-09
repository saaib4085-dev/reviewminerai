// Minimal Stripe client for Cloudflare Workers (no SDK needed).
import type { Env } from './env';
import { CREDIT_PACKS, type PackId } from '../shared/types';
import { HttpError } from './http';

export interface StripeCharge {
  billing_details?: { name?: string | null } | null;
  payment_method_details?: {
    type?: string;
    card?: { brand?: string; last4?: string; funding?: string; wallet?: { type?: string } | null } | null;
    sepa_debit?: { last4?: string } | null;
  } | null;
}

export interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  amount_received?: number;
  currency: string;
  client_secret?: string;
  metadata?: Record<string, string>;
  latest_charge?: string | StripeCharge | null;
  last_payment_error?: { message?: string } | null;
}

async function stripe<T>(env: Env, path: string, init: { method: 'GET' | 'POST'; body?: URLSearchParams }): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set');
    throw new HttpError(503, 'PAYMENTS_OFF', 'Payments aren’t switched on yet. Please check back soon.');
  }
  let res: Response;
  try {
    res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        ...(init.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: init.body,
    });
  } catch {
    throw new HttpError(504, 'PAYMENT_PROVIDER_DOWN', 'We couldn’t reach the payment provider. Please try again.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !data) {
    console.error('Stripe error', res.status, data?.error?.message);
    throw new HttpError(502, 'PAYMENT_ERROR', 'The payment provider had a problem. You haven’t been charged. Please try again.');
  }
  return data;
}

/**
 * The Stripe price for a pack. The live price IDs are built in (shared/types.ts); a
 * STRIPE_PRICE_<PACK> setting replaces one, which is how you use test-mode prices with a test key
 * (test and live mode in Stripe are completely separate, so live prices don't exist for a test key).
 */
export function priceIdFor(env: Env, pack: PackId): string {
  const overrides: Record<PackId, string | undefined> = {
    starter: env.STRIPE_PRICE_STARTER,
    core: env.STRIPE_PRICE_CORE,
    pro: env.STRIPE_PRICE_PRO,
    elite: env.STRIPE_PRICE_ELITE,
    apex: env.STRIPE_PRICE_APEX,
  };
  return overrides[pack]?.trim() || CREDIT_PACKS[pack].stripePriceId;
}

export interface StripePrice {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  product: string;
}

export function getPrice(env: Env, id: string): Promise<StripePrice> {
  return stripe<StripePrice>(env, `prices/${encodeURIComponent(id)}`, { method: 'GET' });
}

/**
 * Safety check before taking money: the pack's Stripe price must be active, in euros and the
 * same amount as Supabase's credit_packs table. If someone changes one but not the other,
 * we stop selling that pack instead of charging the wrong amount.
 */
export async function checkPackPrice(env: Env, priceId: string, expectedCents: number, currency: string): Promise<StripePrice> {
  const price = await getPrice(env, priceId);
  if (!price.active || price.currency !== currency.toLowerCase() || price.unit_amount !== expectedCents) {
    console.error('Stripe price does not match credit_packs', {
      priceId,
      active: price.active,
      stripe: `${price.unit_amount} ${price.currency}`,
      supabase: `${expectedCents} ${currency}`,
    });
    throw new HttpError(503, 'PRICE_MISMATCH', 'This pack is being updated. Please try again shortly or choose another pack.');
  }
  return price;
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  payment_intent: string | StripePaymentIntent | null;
  payment_method_types?: string[];
  metadata?: Record<string, string>;
}

/**
 * Creates a Stripe-hosted checkout page for a pack. Stripe shows the payment methods you've switched
 * on (cards, Apple Pay, Google Pay, SEPA Direct Debit…), takes the money and sends the buyer back.
 * The order details are copied onto the payment itself (payment_intent_data), so the webhook and
 * /api/verify-payment can match it to the order.
 */
function checkoutBody(
  o: { priceId: string; orderId: string; userId: string; email?: string; pack: string; credits: number; origin: string },
  withConsent: boolean,
): URLSearchParams {
  const meta: Record<string, string> = {
    kind: 'voucher',
    user_id: o.userId,
    pack: o.pack,
    credits: String(o.credits),
    gift: 'no',
    order_id: o.orderId,
    price_id: o.priceId,
  };
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': o.priceId,
    'line_items[0][quantity]': '1',
    success_url: `${o.origin}/checkout/success?order=${o.orderId}`,
    cancel_url: `${o.origin}/checkout/cancelled?order=${o.orderId}`,
    client_reference_id: o.userId,
    'payment_intent_data[description]': `Review Miner ${o.pack} pack (${o.credits} credits)`,
  });
  for (const [k, v] of Object.entries(meta)) {
    body.set(`metadata[${k}]`, v);
    body.set(`payment_intent_data[metadata][${k}]`, v);
  }
  if (o.email) body.set('customer_email', o.email);

  const terms = `${o.origin}/terms`;
  const privacy = `${o.origin}/privacy`;
  if (withConsent) {
    // A required "I agree" checkbox on Stripe's page, above the Pay button.
    body.set('consent_collection[terms_of_service]', 'required');
    body.set(
      'custom_text[terms_of_service_acceptance][message]',
      `I agree to the [Terms and Conditions](${terms}) and [Privacy Policy](${privacy}). I want my credits delivered as soon as my payment is confirmed and understand that I lose my 14-day right of withdrawal once they’re delivered.`,
    );
  } else {
    body.set(
      'custom_text[submit][message]',
      `By paying you agree to the Terms (${terms}) and Privacy Policy (${privacy}), and ask for your credits to be delivered straight away, which ends your 14-day right of withdrawal once they’re delivered.`,
    );
  }
  return body;
}

/**
 * Creates a Stripe-hosted checkout page for a pack. Stripe shows the payment methods you've switched
 * on (cards, Apple Pay, Google Pay, SEPA Direct Debit…), takes the money and sends the buyer back.
 * The order details are copied onto the payment itself (payment_intent_data), so the webhook and
 * /api/verify-payment can match it to the order.
 * The Terms are a required checkbox on Stripe's page. That needs a Terms of service URL in
 * Stripe → Settings → Public details; until it's set, the Terms are shown as a note above the Pay button instead.
 */
export async function createCheckoutSession(
  env: Env,
  o: { priceId: string; orderId: string; userId: string; email?: string; pack: string; credits: number; origin: string },
): Promise<StripeCheckoutSession> {
  try {
    return await stripe<StripeCheckoutSession>(env, 'checkout/sessions', { method: 'POST', body: checkoutBody(o, true) });
  } catch (err) {
    console.warn('Checkout with a Terms checkbox failed; retrying with a Terms note. Set a Terms URL in Stripe → Settings → Public details.');
    return stripe<StripeCheckoutSession>(env, 'checkout/sessions', { method: 'POST', body: checkoutBody(o, false) });
  }
}

/**
 * Closes an unpaid Stripe checkout page so it can't be paid any more (used when the buyer cancels).
 * Returns the page's final status: 'expired' when closed, 'complete' if it was paid after all.
 */
export async function expireCheckoutSession(env: Env, id: string): Promise<'expired' | 'complete' | 'open'> {
  const current = await stripe<StripeCheckoutSession>(env, `checkout/sessions/${encodeURIComponent(id)}`, { method: 'GET' });
  if (current.status !== 'open') return current.status;
  const closed = await stripe<StripeCheckoutSession>(env, `checkout/sessions/${encodeURIComponent(id)}/expire`, {
    method: 'POST',
    body: new URLSearchParams(),
  });
  return closed.status;
}

/** Reads a checkout page's result, including the payment and its card / bank details. */
export function getCheckoutSession(env: Env, id: string): Promise<StripeCheckoutSession> {
  return stripe<StripeCheckoutSession>(
    env,
    `checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent&expand[]=payment_intent.latest_charge`,
    { method: 'GET' },
  );
}

/** Asks Stripe directly about a payment (with the card / bank details needed for the receipt). */
export function getPaymentIntent(env: Env, id: string): Promise<StripePaymentIntent> {
  return stripe<StripePaymentIntent>(env, `payment_intents/${encodeURIComponent(id)}?expand[]=latest_charge`, { method: 'GET' });
}

const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const BRANDS: Record<string, string> = { amex: 'American Express', diners: 'Diners Club', unionpay: 'UnionPay', mastercard: 'Mastercard', visa: 'Visa' };

/** "Visa •••• 4242 · debit card", "Apple Pay (Mastercard •••• 4444)", "SEPA Direct Debit •••• 3000" */
export function describePayment(pi: StripePaymentIntent): { label: string | null; payer: string | null } {
  const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const d = charge?.payment_method_details;
  const payer = charge?.billing_details?.name ?? null;
  if (d?.type === 'card' && d.card) {
    const base = `${BRANDS[d.card.brand ?? ''] ?? cap(d.card.brand)} •••• ${d.card.last4 ?? ''}`.trim();
    const wallet = d.card.wallet?.type;
    if (wallet === 'apple_pay') return { label: `Apple Pay (${base})`, payer };
    if (wallet === 'google_pay') return { label: `Google Pay (${base})`, payer };
    const funding = d.card.funding === 'credit' ? ' · credit card' : d.card.funding === 'debit' ? ' · debit card' : '';
    return { label: `${base}${funding}`, payer };
  }
  if (d?.type === 'sepa_debit') return { label: `SEPA Direct Debit •••• ${d.sepa_debit?.last4 ?? ''}`.trim(), payer };
  return { label: d?.type ? cap(d.type.replace(/_/g, ' ')) : null, payer };
}

const encoder = new TextEncoder();
const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checks a webhook really came from Stripe (HMAC-SHA256 signature, max 5 minutes old). */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string | undefined): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || !signatures.length) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)));
  return signatures.some((s) => safeEqual(s, expected));
}
