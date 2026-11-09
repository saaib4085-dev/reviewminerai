// POST /api/redeem
// Redeems a single-use voucher code for credits.
//
// Security:
//  - The account comes from the sign-in token, never from the request body.
//  - Codes are claimed and credited in ONE database transaction (redeem_promo_code),
//    so a code can only ever be used once, even with simultaneous requests.
//  - Brute-force protection: 10 wrong codes per account and 30 per connection (IP) per hour.
//  - A code can also unlock a tier (Starter … Apex). Tiers only go up.

import type { Env } from '../../server/env';
import { HttpError, handleError, json, readJson, requireEnv } from '../../server/http';
import { requireUser, serviceClient } from '../../server/supabase';
import { isTier, normalizeVoucher, type RedeemRequest, type RedeemResponse } from '../../shared/types';

const INVALID = 'Invalid or spent voucher code.';

interface RedeemRow {
  status: 'ok' | 'invalid' | 'rate_limited';
  credits_added: number | string | null;
  new_balance: number | string | null;
  new_tier: string | null;
  tier_upgraded: boolean | null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']);
    const db = serviceClient(env);
    const user = await requireUser(request, db);

    const body = await readJson<Partial<RedeemRequest>>(request);
    if (body.userId !== undefined && body.userId !== user.id) {
      throw new HttpError(403, 'FORBIDDEN', 'You can only redeem vouchers for your own account.');
    }

    const code = normalizeVoucher(body.code);
    if (!code) throw new HttpError(400, 'INVALID_VOUCHER', INVALID);

    // The visitor's IP lets the database slow down people guessing codes from many accounts.
    const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const { data, error } = await db.rpc('redeem_promo_code', { p_user_id: user.id, p_code: code, p_ip: ip });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as RedeemRow | null;

    if (row?.status === 'rate_limited') {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes. Please wait an hour and try again.');
    }
    if (row?.status !== 'ok') {
      throw new HttpError(400, 'INVALID_VOUCHER', INVALID);
    }

    const response: RedeemResponse = {
      success: true,
      newCredits: Number(row.new_balance),
      creditsAdded: Number(row.credits_added),
      newTier: isTier(row.new_tier) ? row.new_tier : 'Free',
      tierUpgraded: row.tier_upgraded === true,
    };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
};
