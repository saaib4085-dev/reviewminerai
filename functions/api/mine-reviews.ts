// POST /api/mine-reviews  (also available as POST /api/analyze-reviews)
// Analyses a product's reviews and charges 1.5 credits, only after a usable report.
//  1. Sign-in, input and credit checks; per-user AI limits (AI_HOURLY_LIMIT / AI_DAILY_LIMIT).
//  2. Firecrawl reads the product page when it can (optional: if the store blocks it,
//     or FIRECRAWL_API_KEY isn't set, the engine relies on web search alone).
//  3. Claude (ENGINE_SYSTEM_PROMPT + native web search) researches the reviews and returns JSON.
//  4. The JSON is converted into the dashboard's Report shape, saved, and the credits are spent.
// Every request is recorded in ai_usage (tokens, web searches, outcome).

import type { Env } from '../../server/env';
import { HttpError, handleError, json, readJson, requireEnv } from '../../server/http';
import { assertHasCredits, requireUser, serviceClient, spendCredits } from '../../server/supabase';
import { scrapePage } from '../../server/firecrawl';
import { askClaudeWithWebSearch, extractJson, type AiUsage } from '../../server/claude';
import { ENGINE_SYSTEM_PROMPT, buildEngineUserMessage, engineToReport } from '../../server/engine';
import { parseFocuses, parseProductUrl, parseQuestion } from '../../server/report';
import { enforceAiRateLimit, recordUsage, usageStatusFor } from '../../server/usage';
import { DEFAULT_FOCUSES, LINK_COST, type Analysis, type MineRequest, type MineResponse } from '../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const startedAt = Date.now();
  let userId: string | null = null;
  let url: string | null = null;
  let usage: AiUsage | null = null;
  let aiCalled = false;
  let pageFetched: boolean | null = null;
  try {
    requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']);
    const db = serviceClient(env);
    const user = await requireUser(request, db);

    const body = await readJson<Partial<MineRequest>>(request);
    url = parseProductUrl(body.url);
    const question = parseQuestion(body.question);
    let focuses = parseFocuses(body.focuses);
    if (focuses.length === 0 && !question) focuses = DEFAULT_FOCUSES;
    const groupId =
      typeof body.groupId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.groupId)
        ? body.groupId
        : null;

    // Nothing runs (no page reading, no charge) until the Anthropic key is set.
    if (!env.ANTHROPIC_API_KEY) {
      throw new HttpError(503, 'AI_NOT_CONNECTED', 'The AI isn’t connected yet, so searches are switched off for now. No credit was used.');
    }

    userId = user.id; // from here on, the request is recorded in ai_usage
    // 1. Credit gate and usage limits before any paid API call.
    await assertHasCredits(db, user.id, LINK_COST);
    await enforceAiRateLimit(db, env, user.id);

    // 2. Read the page if we can (optional).
    let page: { title: string | null; markdown: string } | null = null;
    if (env.FIRECRAWL_API_KEY) {
      try {
        page = await scrapePage(url, env.FIRECRAWL_API_KEY);
        pageFetched = true;
      } catch (err) {
        pageFetched = false;
        console.warn('Page could not be read; using web search only', url, err instanceof Error ? err.message : err);
      }
    }

    // 3. The review engine: system prompt + the user's link/question (+ page) + native web search.
    aiCalled = true;
    const result = await askClaudeWithWebSearch(env, ENGINE_SYSTEM_PROMPT, buildEngineUserMessage(url, question, page), 4096);
    usage = result.usage;
    const parsed = extractJson(result.text);
    if (!parsed) {
      console.error('Unparseable model reply:', result.text.slice(0, 400));
      throw new HttpError(502, 'AI_BAD_OUTPUT', 'The analysis came back garbled. Please try again. No credit was used.');
    }

    // 4. Convert to what the dashboard renders.
    const report = engineToReport(parsed, page?.title ?? null, focuses, question);
    if (report.data_quality === 'none') {
      throw new HttpError(422, 'NO_REVIEWS', 'We couldn’t find customer reviews for this product, on the page or across the web. No credit was used.');
    }

    // 5. Save.
    const { data: saved, error: insertError } = await db
      .from('analyses')
      .insert({
        user_id: user.id,
        group_id: groupId,
        url,
        product_name: report.product_name,
        focuses,
        question,
        report,
        // Kept for follow-up questions: the page text, or the engine's findings when the page couldn't be read.
        source_markdown: (page?.markdown ?? `Review findings for ${url}:\n${JSON.stringify(parsed)}`).slice(0, 60000),
      })
      .select('id, group_id, url, product_name, focuses, question, report, created_at')
      .single();
    if (insertError || !saved) throw insertError ?? new Error('Insert returned no row');

    // 6. Charge 1.5 credits (atomic). If a parallel request used the last credit, undo.
    const balance = await spendCredits(db, user.id, LINK_COST, 'analysis', saved.id);
    if (balance < 0) {
      await db.from('analyses').delete().eq('id', saved.id);
      throw new HttpError(402, 'NO_CREDITS', 'You don’t have enough credits left. Add more to keep going.');
    }

    await recordUsage(db, { userId: user.id, endpoint: 'analyze', url, status: 'ok', usage, pageFetched, creditsCharged: LINK_COST, startedAt });
    const response: MineResponse = { analysis: saved as Analysis, credits: balance };
    return json(response);
  } catch (err) {
    if (userId) {
      const { status, code } = usageStatusFor(err, aiCalled);
      await recordUsage(serviceClient(env), { userId, endpoint: 'analyze', url, status, errorCode: code, usage, pageFetched, startedAt });
    }
    return handleError(err);
  }
};
