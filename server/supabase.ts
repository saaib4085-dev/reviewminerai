import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Env } from './env';
import { HttpError } from './http';
import { formatCredits } from '../shared/types';

export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function requireUser(request: Request, db: SupabaseClient): Promise<User> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in to continue.');

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
  }
  return data.user;
}

export async function getCredits(db: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await db.from('profiles').select('credits').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Number(data?.credits ?? 0);
}

export async function assertHasCredits(db: SupabaseClient, userId: string, cost: number): Promise<void> {
  const credits = await getCredits(db, userId);
  if (credits < cost) {
    throw new HttpError(
      402,
      'NO_CREDITS',
      `This needs ${formatCredits(cost)} credits and you have ${formatCredits(credits)}. Add more to keep going.`,
    );
  }
}

/** Atomically spends credits. Returns the new balance, or -1 if there weren't enough. */
export async function spendCredits(
  db: SupabaseClient,
  userId: string,
  amount: number,
  reason: 'analysis' | 'follow_up',
  analysisId: string,
): Promise<number> {
  const { data, error } = await db.rpc('consume_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_analysis_id: analysisId,
  });
  if (error) throw error;
  const balance = Number(data);
  return Number.isFinite(balance) ? balance : -1;
}
