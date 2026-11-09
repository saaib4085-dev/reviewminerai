import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { HttpError, requireEnv } from './http';
import { requireUser, serviceClient } from './supabase';
import { requireAdmin } from './orders';
import { isTier, type AdminTransaction, type AdminUser } from '../shared/types';

/** Every /api/admin/* endpoint starts here: signed in AND listed in app_admins, checked on the server. */
export async function adminContext(request: Request, env: Env): Promise<{ db: SupabaseClient; adminId: string }> {
  requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']);
  const db = serviceClient(env);
  const user = await requireUser(request, db);
  await requireAdmin(db, user.id);
  return { db, adminId: user.id };
}

export function parseUserId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Missing user.');
  }
  return value;
}

export const PROFILE_COLUMNS = 'user_id, email, credits, tier, created_at';

export function toAdminUser(r: Record<string, unknown>): AdminUser {
  return {
    userId: String(r.user_id),
    email: (r.email as string | null) ?? null,
    credits: Number(r.credits ?? 0),
    tier: isTier(r.tier) ? r.tier : 'Free',
    createdAt: String(r.created_at),
  };
}

export const TRANSACTION_COLUMNS = 'id, user_id, amount, balance_after, reason, note, created_at';

export async function toAdminTransactions(db: SupabaseClient, rows: Record<string, unknown>[]): Promise<AdminTransaction[]> {
  const ids = [...new Set(rows.map((r) => String(r.user_id)))];
  const emails = new Map<string, string>();
  if (ids.length) {
    const { data, error } = await db.from('profiles').select('user_id, email').in('user_id', ids);
    if (error) throw error;
    for (const p of data ?? []) if (p.email) emails.set(String(p.user_id), String(p.email));
  }
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    email: emails.get(String(r.user_id)) ?? null,
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    reason: String(r.reason),
    note: (r.note as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
}
