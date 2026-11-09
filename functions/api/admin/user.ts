// POST /api/admin/user  { userId }  → one user's balance, tier, ledger, orders and AI usage (admins only).
import type { Env } from '../../../server/env';
import { HttpError, handleError, json, readJson } from '../../../server/http';
import { PROFILE_COLUMNS, TRANSACTION_COLUMNS, adminContext, parseUserId, toAdminTransactions, toAdminUser } from '../../../server/admin';
import { ORDER_COLUMNS, toOrder } from '../../../server/orders';
import type { AdminUserDetailResponse } from '../../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { db } = await adminContext(request, env);
    const userId = parseUserId((await readJson<{ userId?: unknown }>(request)).userId);

    const { data: profile, error } = await db.from('profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!profile) throw new HttpError(404, 'NOT_FOUND', 'User not found.');

    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [txns, orders, admin, requests, errors, last, analyses] = await Promise.all([
      db.from('credit_transactions').select(TRANSACTION_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
      db.from('voucher_orders').select(ORDER_COLUMNS).eq('user_id', userId).neq('status', 'pending').order('created_at', { ascending: false }).limit(25),
      db.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle(),
      db.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).neq('status', 'rejected').gte('created_at', since),
      db.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'error').gte('created_at', since),
      db.from('ai_usage').select('created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('analyses').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ]);
    for (const r of [txns, orders, admin, requests, errors, last, analyses]) if (r.error) throw r.error;

    const response: AdminUserDetailResponse = {
      user: toAdminUser(profile as Record<string, unknown>),
      isAdmin: !!admin.data,
      transactions: await toAdminTransactions(db, (txns.data ?? []) as Record<string, unknown>[]),
      orders: (orders.data ?? []).map(toOrder),
      usage: {
        requests30d: requests.count ?? 0,
        errors30d: errors.count ?? 0,
        lastRequestAt: (last.data?.created_at as string | undefined) ?? null,
      },
      analysesCount: analyses.count ?? 0,
    };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
};
