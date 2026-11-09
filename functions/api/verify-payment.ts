// POST /api/verify-payment
// Called by the "being checked and confirmed" page after the buyer returns from Stripe.
// Asks Stripe directly (server to server) whether the order was paid, saves the answer in Supabase,
// and Supabase verifies it (confirmed, same account, euros, full price) before adding the pack's
// credits and tier to the buyer's account. Only ever happens once per payment.

import type { Env } from '../../server/env';
import { handleError, json, readJson, requireEnv } from '../../server/http';
import { requireUser, serviceClient } from '../../server/supabase';
import { verifyOrder } from '../../server/checkout';
import { parseOrderId } from '../../server/orders';
import type { OrderIdRequest } from '../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']);
    const db = serviceClient(env);
    const user = await requireUser(request, db);
    const orderId = parseOrderId((await readJson<Partial<OrderIdRequest>>(request)).orderId);
    return json(await verifyOrder(env, db, user, orderId));
  } catch (err) {
    return handleError(err);
  }
};
