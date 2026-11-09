// POST /api/admin/users  { search? }  → newest users, or users whose email matches (admins only).
import type { Env } from '../../../server/env';
import { handleError, json, readJson } from '../../../server/http';
import { PROFILE_COLUMNS, adminContext, toAdminUser } from '../../../server/admin';
import type { AdminUsersRequest, AdminUsersResponse } from '../../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { db } = await adminContext(request, env);
    const body = await readJson<Partial<AdminUsersRequest>>(request);
    // Keep only characters that can appear in an email; % and _ would act as wildcards.
    const search = typeof body.search === 'string' ? body.search.trim().toLowerCase().replace(/[^a-z0-9@.+-]/g, '').slice(0, 100) : '';

    let query = db.from('profiles').select(PROFILE_COLUMNS).order('created_at', { ascending: false }).limit(50);
    if (search) query = query.ilike('email', `%${search}%`);
    const { data, error } = await query;
    if (error) throw error;

    const response: AdminUsersResponse = { users: (data ?? []).map((r) => toAdminUser(r as Record<string, unknown>)) };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
};
