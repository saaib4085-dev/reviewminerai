import type { Env } from './env';
import { HttpError } from './http';

/**
 * Default model. claude-3-5-haiku-20241022 was retired on Feb 19, 2026 (requests to it fail),
 * so the newest model in the same fast, low-cost Haiku family is used. Override with ANTHROPIC_MODEL.
 */
export const DEFAULT_MODEL = 'claude-haiku-5-5';

/** How many web searches Claude may run per product (each search is billed by Anthropic). */
const DEFAULT_MAX_SEARCHES = 3;

interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}
interface AnthropicResponse {
  content?: ContentBlock[];
  stop_reason?: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
  error?: { message?: string };
}

/** What a request used: recorded in Supabase's ai_usage table. */
export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
}
export interface AiResult {
  text: string;
  usage: AiUsage;
}

function addUsage(total: AiUsage, data: AnthropicResponse): AiUsage {
  return {
    model: data.model || total.model,
    inputTokens: total.inputTokens + (data.usage?.input_tokens ?? 0),
    outputTokens: total.outputTokens + (data.usage?.output_tokens ?? 0),
    webSearches: total.webSearches + (data.usage?.server_tool_use?.web_search_requests ?? 0),
  };
}

async function callMessages(env: Env, body: Record<string, unknown>): Promise<AnthropicResponse> {
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150000),
    });
  } catch {
    throw new HttpError(504, 'AI_TIMEOUT', 'The analysis took too long. Please try again. No credit was used.');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Anthropic error', res.status, detail.slice(0, 600));
    if (res.status === 429 || res.status === 529) {
      throw new HttpError(503, 'AI_BUSY', 'The AI is very busy right now. Please try again in a minute. No credit was used.');
    }
    if (/web.?search/i.test(detail) && /(enable|disabled|not allowed|permission)/i.test(detail)) {
      throw new HttpError(503, 'WEB_SEARCH_OFF', 'Web search isn’t switched on for this AI account yet. No credit was used.');
    }
    if (res.status === 404 || /model/i.test(detail) && /(not found|invalid|retired|deprecated)/i.test(detail)) {
      throw new HttpError(503, 'AI_MODEL', 'The AI model isn’t available. The site owner needs to update ANTHROPIC_MODEL. No credit was used.');
    }
    throw new HttpError(502, 'AI_FAILED', 'The analysis didn’t finish. Please try again. No credit was used.');
  }
  return (await res.json()) as AnthropicResponse;
}

/** Plain request without tools (used for follow-up questions). */
export async function askClaude(env: Env, system: string, user: string, maxTokens: number): Promise<AiResult> {
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const data = await callMessages(env, {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return { text: finalText(data.content ?? []), usage: addUsage({ model, inputTokens: 0, outputTokens: 0, webSearches: 0 }, data) };
}

/**
 * Request with Anthropic's native web search tool. Claude decides what to search, the API runs the
 * searches, and Claude writes its final answer. Long searches can pause ("pause_turn"); we continue
 * the same turn until Claude is done.
 */
export async function askClaudeWithWebSearch(env: Env, system: string, user: string, maxTokens: number): Promise<AiResult> {
  const maxSearches = Math.min(10, Math.max(1, Number(env.ANTHROPIC_MAX_SEARCHES) || DEFAULT_MAX_SEARCHES));
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }];
  const messages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] = [{ role: 'user', content: user }];

  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  let usage: AiUsage = { model, inputTokens: 0, outputTokens: 0, webSearches: 0 };
  let content: ContentBlock[] = [];
  for (let round = 0; round < 4; round++) {
    const data = await callMessages(env, {
      model,
      max_tokens: maxTokens,
      system,
      tools,
      messages,
    });
    usage = addUsage(usage, data);
    content = [...content, ...(data.content ?? [])];
    if (data.stop_reason !== 'pause_turn') break;
    // Continue the paused turn: send back what Claude has done so far.
    messages.push({ role: 'assistant', content: data.content ?? [] });
  }
  return { text: finalText(content), usage };
}

/**
 * The answer is the text after the last search result. Text blocks are joined WITHOUT separators,
 * because citations can split one JSON string across several blocks.
 */
function finalText(content: ContentBlock[]): string {
  let lastTool = -1;
  content.forEach((b, i) => {
    if (b.type === 'web_search_tool_result' || b.type === 'server_tool_use') lastTool = i;
  });
  const after = content.slice(lastTool + 1).filter((b) => b.type === 'text');
  const blocks = after.length ? after : content.filter((b) => b.type === 'text');
  return blocks.map((b) => b.text ?? '').join('');
}

/** Pulls the JSON object out of a model reply. Returns null instead of throwing. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
