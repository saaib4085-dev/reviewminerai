// POST /api/ask
// Ask a follow-up question about the product(s) in a chat. Costs 1.5 credits on success.
// When a chat has several products, the answer compares them.
// Subject to the same per-user AI limits as searches; every request is recorded in ai_usage.

import type { Env } from '../../server/env';
import { HttpError, handleError, json, readJson, requireEnv } from '../../server/http';
import { assertHasCredits, requireUser, serviceClient, spendCredits } from '../../server/supabase';
import { askClaude, extractJson, type AiUsage } from '../../server/claude';
import { enforceAiRateLimit, recordUsage, usageStatusFor } from '../../server/usage';
import { buildFollowUpPrompt, normalizeFollowUp, parseQuestion } from '../../server/report';
import { FOLLOW_UP_COST, MAX_LINKS, type AskRequest, type AskResponse, type FollowUp } from '../../shared/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const startedAt = Date.now();
  let userId: string | null = null;
  let usage: AiUsage | null = null;
  let aiCalled = false;
  try {
    requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']);
    const db = serviceClient(env);
    const user = await requireUser(request, db);

    const body = await readJson<Partial<AskRequest>>(request);
    const question = parseQuestion(body.question, 600);
    if (!question) throw new HttpError(400, 'EMPTY_QUESTION', 'Type a question first.');

    const requested = (Array.isArray(body.analysisIds) ? body.analysisIds : [body.analysisId])
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .slice(0, MAX_LINKS);
    if (requested.length === 0) {
      throw new HttpError(400, 'BAD_REQUEST', 'Open a product first, then ask your question.');
    }

    const { data: rows, error } = await db
      .from('analyses')
      .select('id, product_name, report, source_markdown')
      .in('id', requested)
      .eq('user_id', user.id);
    if (error) throw error;

    const products = requested
      .map((id) => rows?.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => !!r && typeof r.source_markdown === 'string' && r.source_markdown.length > 0);
    if (products.length === 0) {
      throw new HttpError(404, 'NOT_FOUND', 'We couldn’t find those products in your history. Paste the links again to start fresh.');
    }

    // Nothing runs (and nothing is charged) until the Anthropic key is set.
    if (!env.ANTHROPIC_API_KEY) {
      throw new HttpError(
        503,
        'AI_NOT_CONNECTED',
        'The AI isn’t connected yet, so searches are switched off for now. No credit was used.',
      );
    }

    userId = user.id; // from here on, the request is recorded in ai_usage
    await assertHasCredits(db, user.id, FOLLOW_UP_COST);
    await enforceAiRateLimit(db, env, user.id);

    const prompt = buildFollowUpPrompt(
      question,
      products.map((p) => ({
        name: String(p.product_name ?? p.report?.product_name ?? 'Product'),
        verdict: typeof p.report?.verdict === 'string' ? p.report.verdict : '',
        markdown: p.source_markdown as string,
      })),
    );
    aiCalled = true;
    const result = await askClaude(env, prompt.system, prompt.user, products.length > 1 ? 1400 : 900);
    usage = result.usage;
    const parsed = extractJson(result.text);
    if (!parsed) {
      console.error('Unparseable follow-up reply:', result.text.slice(0, 400));
      throw new HttpError(502, 'AI_BAD_OUTPUT', 'The answer came back garbled. Please try again. No credit was used.');
    }
    const answer = normalizeFollowUp(parsed);
    const primaryId = products[0].id as string;

    const { data: saved, error: insertError } = await db
      .from('analysis_messages')
      .insert({ analysis_id: primaryId, user_id: user.id, question, answer })
      .select('id, analysis_id, question, answer, created_at')
      .single();
    if (insertError || !saved) throw insertError ?? new Error('Insert returned no row');

    const balance = await spendCredits(db, user.id, FOLLOW_UP_COST, 'follow_up', primaryId);
    if (balance < 0) {
      await db.from('analysis_messages').delete().eq('id', saved.id);
      throw new HttpError(402, 'NO_CREDITS', 'You don’t have enough credits left. Add more to keep going.');
    }

    await recordUsage(db, { userId: user.id, endpoint: 'ask', status: 'ok', usage, creditsCharged: FOLLOW_UP_COST, startedAt });
    const response: AskResponse = { followUp: saved as FollowUp, credits: balance };
    return json(response);
  } catch (err) {
    if (userId) {
      const { status, code } = usageStatusFor(err, aiCalled);
      await recordUsage(serviceClient(env), { userId, endpoint: 'ask', status, errorCode: code, usage, startedAt });
    }
    return handleError(err);
  }
};
