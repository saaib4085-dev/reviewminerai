// AI usage limits and tracking (Supabase table ai_usage, migration 017).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { HttpError } from './http';
import type { AiUsage } from './claude';

const DEFAULT_HOURLY = 30;
const DEFAULT_DAILY = 200;

function limit(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** Stops one account from running up AI costs: AI_HOURLY_LIMIT / AI_DAILY_LIMIT requests (defaults 30 / 200). */
export async function enforceAiRateLimit(db: SupabaseClient, env: Env, userId: string): Promise<void> {
  const { data, error } = await db.rpc('check_ai_rate_limit', {
    p_user_id: userId,
    p_hourly: limit(env.AI_HOURLY_LIMIT, DEFAULT_HOURLY),
    p_daily: limit(env.AI_DAILY_LIMIT, DEFAULT_DAILY),
  });
  if (error) throw error;
  if (data === 'hourly') {
    throw new HttpError(429, 'RATE_LIMITED', 'You’ve reached the limit of searches per hour. Please try again a little later. No credit was used.');
  }
  if (data === 'daily') {
    throw new HttpError(429, 'RATE_LIMITED', 'You’ve reached today’s search limit. Please try again tomorrow. No credit was used.');
  }
}

export interface UsageRecord {
  userId: string;
  endpoint: 'analyze' | 'ask';
  url?: string | null;
  status: 'ok' | 'error' | 'rejected';
  errorCode?: string | null;
  usage?: AiUsage | null;
  pageFetched?: boolean | null;
  creditsCharged?: number;
  startedAt: number;
}

/** Records one AI request. Never throws: tracking must not break a search. */
export async function recordUsage(db: SupabaseClient, r: UsageRecord): Promise<void> {
  try {
    const { error } = await db.from('ai_usage').insert({
      user_id: r.userId,
      endpoint: r.endpoint,
      url: r.url ?? null,
      status: r.status,
      error_code: r.errorCode ?? null,
      model: r.usage?.model ?? null,
      input_tokens: r.usage?.inputTokens ?? 0,
      output_tokens: r.usage?.outputTokens ?? 0,
      web_searches: r.usage?.webSearches ?? 0,
      page_fetched: r.pageFetched ?? null,
      credits_charged: r.creditsCharged ?? 0,
      duration_ms: Date.now() - r.startedAt,
    });
    if (error) console.error('Could not record AI usage', error.message);
  } catch (err) {
    console.error('Could not record AI usage', err);
  }
}

/** Errors before the AI was called (no credits, bad input, limits) are 'rejected' and don't count towards limits. */
export function usageStatusFor(err: unknown, aiCalled: boolean): { status: 'error' | 'rejected'; code: string } {
  const code = err instanceof HttpError ? err.code : 'SERVER_ERROR';
  return { status: aiCalled ? 'error' : 'rejected', code };
}
