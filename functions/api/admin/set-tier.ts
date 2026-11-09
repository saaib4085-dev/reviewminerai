// POST /api/admin/set-tier  { userId, tier }  → change a user's tier (admins only).
import type { Env } from '../../../server/env';
import { HttpError, handleError, json, readJson } from '../../../server/http';
import { adminContext, parseUserId } from '../../../server/admin';
import { isTier, type AdminSetTierRequest } from '../../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { db, adminId } = await adminContext(request, env);
    const body = await readJson<Partial<AdminSetTierRequest>>(request);
    const userId = parseUserId(body.userId);
    if (!isTier(body.tier)) throw new HttpError(400, 'BAD_REQUEST', 'Choose a tier.');

    const { data, error } = await db.rpc('admin_set_tier', { p_admin_id: adminId, p_user_id: userId, p_tier: body.tier });
    if (error) throw error;
    if (data === 'not_admin') throw new HttpError(403, 'NOT_ADMIN', 'Only the site owner can do this.');
    if (data === 'no_user') throw new HttpError(404, 'NOT_FOUND', 'User not found.');
    if (data !== 'ok') throw new HttpError(400, 'BAD_REQUEST', 'That tier isn’t valid.');
    return json({ ok: true, tier: body.tier });
  } catch (err) {
    return handleError(err);
  }
};
