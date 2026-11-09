// POST /api/me  → small facts about the signed-in person (for now: are they an admin?).

import type { Env } from '../../server/env';
import { handleError, json, requireEnv } from '../../server/http';
import { requireUser, serviceClient } from '../../server/supabase';
import { isAdmin } from '../../server/orders';
import type { MeResponse } from '../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']);
    const db = serviceClient(env);
    const user = await requireUser(request, db);
    const response: MeResponse = { isAdmin: await isAdmin(db, user.id) };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
};
