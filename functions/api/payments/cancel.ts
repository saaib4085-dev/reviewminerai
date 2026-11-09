// POST /api/payments/cancel  { orderId }
// Called by the cancellation page when the buyer leaves Stripe's checkout without paying.
// Closes the Stripe checkout page (so it can't be paid later) and marks the order cancelled.
// Only the buyer's own, still-unpaid order can be cancelled.

import type { Env } from '../../../server/env';
import { HttpError, handleError, json, readJson, requireEnv } from '../../../server/http';
import { requireUser, serviceClient } from '../../../server/supabase';
import { expireCheckoutSession } from '../../../server/stripe';
import { parseOrderId } from '../../../server/orders';
import type { CancelCheckoutResponse, OrderIdRequest } from '../../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL', 'STRIPE_SECRET_KEY']);
    const db = serviceClient(env);
    const user = await requireUser(request, db);
    const orderId = parseOrderId((await readJson<Partial<OrderIdRequest>>(request)).orderId);

    const { data: order, error } = await db
      .from('voucher_orders')
      .select('id, status, checkout_session_id')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found.');

    let response: CancelCheckoutResponse;
    if (order.status === 'paid' || order.status === 'processing') {
      response = { status: 'paid' };
    } else if (order.status !== 'pending') {
      response = { status: 'already_closed' };
    } else {
      const stripeStatus = order.checkout_session_id ? await expireCheckoutSession(env, order.checkout_session_id) : 'expired';
      if (stripeStatus === 'complete') {
        // Paid after all (e.g. paid in another tab): the success page will confirm and add the credits.
        response = { status: 'paid' };
      } else {
        const { error: cancelError } = await db.rpc('cancel_pending_order', { p_user_id: user.id, p_order_id: orderId });
        if (cancelError) throw cancelError;
        response = { status: 'cancelled' };
      }
    }
    return json(response);
  } catch (err) {
    return handleError(err);
  }
};
