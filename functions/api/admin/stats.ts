// POST /api/admin/stats  → overview numbers for the Admin page (admins only).
import type { Env } from '../../../server/env';
import { handleError, json } from '../../../server/http';
import { adminContext } from '../../../server/admin';
import type { AdminStatsResponse } from '../../../shared/types';

const DAY = 864e5;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { db } = await adminContext(request, env);
    const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
      const { count: c, error } = await q;
      if (error) throw error;
      return c ?? 0;
    };

    const [total, new7d, new30d, requests24h, errors24h, requests30d] = await Promise.all([
      count(db.from('profiles').select('user_id', { count: 'exact', head: true })),
      count(db.from('profiles').select('user_id', { count: 'exact', head: true }).gte('created_at', ago(7 * DAY))),
      count(db.from('profiles').select('user_id', { count: 'exact', head: true }).gte('created_at', ago(30 * DAY))),
      count(db.from('ai_usage').select('id', { count: 'exact', head: true }).neq('status', 'rejected').gte('created_at', ago(DAY))),
      count(db.from('ai_usage').select('id', { count: 'exact', head: true }).eq('status', 'error').gte('created_at', ago(DAY))),
      count(db.from('ai_usage').select('id', { count: 'exact', head: true }).neq('status', 'rejected').gte('created_at', ago(30 * DAY))),
    ]);

    const { data: paid, error: paidError } = await db
      .from('voucher_orders')
      .select('amount_received_cents, paid_at')
      .eq('status', 'paid')
      .limit(10000);
    if (paidError) throw paidError;
    const cutoff = Date.now() - 30 * DAY;
    const paidRows = paid ?? [];
    const recent = paidRows.filter((o) => o.paid_at && new Date(o.paid_at as string).getTime() > cutoff);
    const sum = (rows: typeof paidRows) => rows.reduce((s, o) => s + Number(o.amount_received_cents ?? 0), 0);

    const { data: usage, error: usageError } = await db
      .from('ai_usage')
      .select('input_tokens, output_tokens, web_searches, credits_charged')
      .gte('created_at', ago(30 * DAY))
      .limit(20000);
    if (usageError) throw usageError;
    const u = (usage ?? []).reduce(
      (a, r) => ({
        i: a.i + Number(r.input_tokens ?? 0),
        o: a.o + Number(r.output_tokens ?? 0),
        w: a.w + Number(r.web_searches ?? 0),
        c: a.c + Number(r.credits_charged ?? 0),
      }),
      { i: 0, o: 0, w: 0, c: 0 },
    );

    const { data: balances, error: balError } = await db.from('profiles').select('credits').limit(50000);
    if (balError) throw balError;

    const response: AdminStatsResponse = {
      users: { total, new7d, new30d },
      revenue: { paid30dCents: sum(recent), orders30d: recent.length, paidAllCents: sum(paidRows), ordersAll: paidRows.length },
      ai: { requests24h, errors24h, requests30d, inputTokens30d: u.i, outputTokens30d: u.o, webSearches30d: u.w, creditsSpent30d: u.c },
      creditsOutstanding: (balances ?? []).reduce((s, p) => s + Number(p.credits ?? 0), 0),
    };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
};
