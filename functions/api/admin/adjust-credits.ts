// POST /api/admin/adjust-credits  { userId, amount, note }  → add or remove credits (admins only).
// Supabase (admin_adjust_credits) re-checks the admin, never lets a balance go below 0, and records
// the change in credit_transactions with the note and the admin who made it.
import type { Env } from '../../../server/env';
import { HttpError, handleError, json, readJson } from '../../../server/http';
import { adminContext, parseUserId } from '../../../server/admin';
import type { AdminAdjustCreditsRequest } from '../../../shared/types';

const MESSAGES: Record<string, [number, string]> = {
  not_admin: [403, 'Only the site owner can do this.'],
  invalid_amount: [400, 'Enter an amount in steps of 0.5, for example 10 or -1.5.'],
  note_required: [400, 'Add a short note explaining the change (3–300 characters).'],
  no_user: [404, 'User not found.'],
  insufficient: [400, 'That would take the balance below 0.'],
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { db, adminId } = await adminContext(request, env);
    const body = await readJson<Partial<AdminAdjustCreditsRequest>>(request);
    const userId = parseUserId(body.userId);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) throw new HttpError(400, 'BAD_REQUEST', MESSAGES.invalid_amount[1]);

    const { data, error } = await db.rpc('admin_adjust_credits', {
      p_admin_id: adminId,
      p_user_id: userId,
      p_amount: amount,
      p_note: typeof body.note === 'string' ? body.note : '',
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as { status: string; new_balance: number | string | null } | null;
    if (row?.status !== 'ok') {
      const [status, message] = MESSAGES[row?.status ?? ''] ?? [500, 'The change couldn’t be saved.'];
      throw new HttpError(status, 'ADJUST_FAILED', message);
    }
    return json({ ok: true, newBalance: Number(row.new_balance) });
  } catch (err) {
    return handleError(err);
  }
};
