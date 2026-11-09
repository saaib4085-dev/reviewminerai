// POST /api/payments/create
// Starts a purchase and returns the URL of Stripe's secure checkout page for the chosen pack.
//  1. Supabase creates the order, with the price from its own credit_packs table.
//  2. The pack's Stripe price is checked against that price (paused if they differ).
//  3. Stripe creates its hosted checkout page. The buyer pays there (card, Apple Pay, Google Pay,
//     SEPA Direct Debit, whatever you've switched on in Stripe), so card details and IBANs never
//     touch this server. Credits are only added after /api/verify-payment or the webhook confirms the money.

import type { Env } from '../../../server/env';
import { handleError, json, readJson, requireEnv } from '../../../server/http';
import { requireUser, serviceClient } from '../../../server/supabase';
import { startCheckout } from '../../../server/checkout';
import type { CheckoutStartRequest } from '../../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL', 'STRIPE_SECRET_KEY']);
    const db = serviceClient(env);
    const user = await requireUser(request, db);
    const body = await readJson<Partial<CheckoutStartRequest>>(request);
    const origin = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    return json(await startCheckout(env, db, user, body, origin));
  } catch (err) {
    return handleError(err);
  }
};
