// POST /api/my-orders  → this person's orders: being confirmed, paid (with receipt and code) or failed.

import type { Env } from '../../server/env';
import { handleError, json, requireEnv } from '../../server/http';
import { requireUser, serviceClient } from '../../server/supabase';
import { ORDER_COLUMNS, toOrder } from '../../server/orders';
import type { MyOrdersResponse } from '../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']);
    const db = serviceClient(env);
    const user = await requireUser(request, db);
    const { data, error } = await db
      .from('voucher_orders')
      .select(ORDER_COLUMNS)
      .eq('user_id', user.id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    // Hide checkouts that were opened but never paid.
    const orders = (data ?? []).map(toOrder).filter((o) => o.status !== 'pending');
    const response: MyOrdersResponse = { orders };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
};
