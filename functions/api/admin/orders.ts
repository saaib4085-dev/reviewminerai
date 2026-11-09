// POST /api/admin/orders  → all orders, for the site owner's Admin page.

import type { Env } from '../../../server/env';
import { handleError, json, requireEnv } from '../../../server/http';
import { requireUser, serviceClient } from '../../../server/supabase';
import { ORDER_COLUMNS, requireAdmin, toAdminOrder } from '../../../server/orders';
import type { AdminOrdersResponse } from '../../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']);
    const db = serviceClient(env);
    const user = await requireUser(request, db);
    await requireAdmin(db, user.id);

    const { data, error } = await db
      .from('voucher_orders')
      .select(ORDER_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;

    const userIds = [...new Set((data ?? []).map((r) => (r as { user_id: string }).user_id))];
    const emails = new Map<string, string>();
    if (userIds.length) {
      const { data: profiles, error: pError } = await db.from('profiles').select('user_id, email').in('user_id', userIds);
      if (pError) throw pError;
      for (const p of profiles ?? []) if (p.email) emails.set(p.user_id as string, p.email as string);
    }

    const response: AdminOrdersResponse = { orders: (data ?? []).map((r) => toAdminOrder(r, emails)) };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
};
