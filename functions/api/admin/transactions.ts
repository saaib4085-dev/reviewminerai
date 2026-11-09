// POST /api/admin/transactions  { reason? }  → the latest 200 credit movements across all users (admins only).
import type { Env } from '../../../server/env';
import { handleError, json, readJson } from '../../../server/http';
import { TRANSACTION_COLUMNS, adminContext, toAdminTransactions } from '../../../server/admin';
import type { AdminTransactionsResponse } from '../../../shared/types';

const REASONS = ['signup_bonus', 'analysis', 'follow_up', 'purchase', 'refund', 'voucher', 'admin_adjustment'];

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { db } = await adminContext(request, env);
    const body = await readJson<{ reason?: unknown }>(request);
    let query = db.from('credit_transactions').select(TRANSACTION_COLUMNS).order('created_at', { ascending: false }).limit(200);
    if (typeof body.reason === 'string' && REASONS.includes(body.reason)) query = query.eq('reason', body.reason);
    const { data, error } = await query;
    if (error) throw error;
    const response: AdminTransactionsResponse = {
      transactions: await toAdminTransactions(db, (data ?? []) as Record<string, unknown>[]),
    };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
};
