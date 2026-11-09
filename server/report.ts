import {
  FOCUS_KEYS,
  type DataQuality,
  type Detail,
  type FocusKey,
  type FollowUpAnswer,
  type Frequency,
  type Report,
  type ThemeItem,
} from '../shared/types';
import { HttpError } from './http';

// ---------- Input helpers ----------

export function parseProductUrl(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  const bad = new HttpError(
    400,
    'BAD_URL',
    'That doesn’t look like a web link. Paste the full product link, like https://www.amazon.com/…',
  );
  if (!raw) throw bad;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw bad;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) throw bad;
  return url.toString();
}

export function parseFocuses(input: unknown): FocusKey[] {
  if (!Array.isArray(input)) return [];
  return FOCUS_KEYS.filter((key) => input.includes(key));
}

export function parseQuestion(input: unknown, max = 500): string | null {
  if (typeof input !== 'string') return null;
  const q = input.trim().slice(0, max);
  return q || null;
}

function trimPage(markdown: string, max: number): string {
  return markdown.length > max ? `${markdown.slice(0, max)}\n\n[page shortened]` : markdown;
}

// ---------- Prompts ----------

function sectionSpec(key: FocusKey, detail: Detail): string {
  const many = detail === 'detailed' ? 8 : 4;
  const few = detail === 'detailed' ? 6 : 3;
  switch (key) {
    case 'love':
      return `"love": up to ${many} items {"theme": short label, "detail": one plain sentence, "frequency": "many" | "some" | "few", "quote": a short real quote from a review (max 20 words) or null}. What buyers like most, most-mentioned first.`;
    case 'complaints':
      return `"complaints": up to ${many} items, same shape as "love". The problems buyers mention, most-mentioned first.`;
    case 'wishes':
      return `"wishes": up to ${few} items {"idea": short label, "detail": one plain sentence}. Things buyers wish the product had or did better.`;
    case 'buyers':
      return `"buyers": up to ${few} items {"type": who they are, e.g. "Busy parents", "why": why they bought it, one sentence}.`;
    case 'ads':
      return '"ads": exactly 3 items {"headline": max 8 words, "body": max 30 words}. Honest ad copy built on what real buyers say. No made-up claims.';
  }
}

export function buildAnalysisPrompt(
  url: string,
  focuses: FocusKey[],
  question: string | null,
  markdown: string,
  detail: Detail = 'quick',
): { system: string; user: string } {
  const system = [
    'You read product pages and summarize what customers say in their reviews.',
    'Rules:',
    '- Use only the page content provided. Never invent reviews, numbers or quotes.',
    '- Write for everyday people: short, plain sentences, no marketing or technical jargon.',
    '- If the page has few or no customer reviews, say so in "data_note" and keep lists short or empty.',
    '- Reply with one JSON object only. No markdown, no code fences, no text before or after it.',
  ].join('\n');

  const wanted = focuses.map((f) => `- ${sectionSpec(f, detail)}`);
  const skipped = FOCUS_KEYS.filter((f) => !focuses.includes(f)).map((f) => `- "${f}": [] (not requested)`);
  const answerSpec = question
    ? `a direct, plain answer to this question from the user: ${JSON.stringify(question)}. 2-4 sentences. Say clearly if the reviews don't cover it.`
    : 'null';

  const user = [
    `Product page: ${url}`,
    '',
    'Return a JSON object with these keys:',
    '- "product_name": string',
    `- "verdict": ${detail === 'detailed' ? '4-5' : '2-3'} plain sentences on what buyers think overall`,
    '- "average_rating": number from 0 to 5, or null if not shown',
    '- "review_count": integer number of reviews shown or stated on the page, or null',
    '- "sentiment": {"positive": int, "neutral": int, "negative": int}, percentages of reviews that add up to 100',
    ...wanted,
    ...skipped,
    `- "answer": ${answerSpec}`,
    '- "data_quality": "good" if there are plenty of reviews, "limited" if only a few, "none" if the page has no customer reviews',
    '- "data_note": one sentence on how much review information there was',
    '',
    '<page>',
    trimPage(markdown, 45000),
    '</page>',
  ].join('\n');

  return { system, user };
}

export function buildFollowUpPrompt(
  question: string,
  products: { name: string; verdict: string; markdown: string }[],
): { system: string; user: string } {
  const many = products.length > 1;
  const system = [
    'You answer questions about products using only their pages and customer reviews.',
    many
      ? 'There are several products. Compare them, and make clear which product each point is about by naming it.'
      : 'There is one product.',
    'Use plain, friendly language for everyday people. If the reviews do not cover the question, say so honestly.',
    'Reply with one JSON object only, no code fences:',
    '{"answer": "2-5 plain sentences", "points": ["up to 5 short supporting points taken from the reviews"]}',
  ].join('\n');

  // Share the page budget across products so the prompt stays a sensible size.
  const perPage = Math.max(8000, Math.floor(36000 / products.length));
  const pages = products
    .map(
      (p, i) =>
        `<product number="${i + 1}" name=${JSON.stringify(p.name)}>\nSummary so far: ${p.verdict}\n\n${trimPage(p.markdown, perPage)}\n</product>`,
    )
    .join('\n\n');

  const user = [`Question: ${JSON.stringify(question)}`, '', pages].join('\n');
  return { system, user };
}

// ---------- Output sanitizers (never trust model JSON shape) ----------

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(/,/g, '')))) {
    return Number(v.replace(/,/g, ''));
  }
  return null;
};
const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const frequency = (v: unknown): Frequency => (v === 'many' || v === 'some' || v === 'few' ? v : 'some');

function themes(v: unknown): ThemeItem[] {
  return objects(v)
    .map((x) => ({
      theme: str(x.theme, 80),
      detail: str(x.detail, 300),
      frequency: frequency(x.frequency),
      quote: str(x.quote, 220) || null,
    }))
    .filter((t) => t.theme)
    .slice(0, 10);
}

export function normalizeReport(raw: unknown, fallbackName: string | null, focuses: FocusKey[]): Report {
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.sentiment) ? r.sentiment : {};
  const pos = Math.max(0, num(s.positive) ?? 0);
  const neu = Math.max(0, num(s.neutral) ?? 0);
  const neg = Math.max(0, num(s.negative) ?? 0);
  const total = pos + neu + neg;
  let sentiment = { positive: 0, neutral: 100, negative: 0 };
  if (total > 0) {
    const p = Math.round((pos / total) * 100);
    const n = Math.round((neg / total) * 100);
    sentiment = { positive: p, negative: n, neutral: Math.max(0, 100 - p - n) };
  }

  const rating = num(r.average_rating);
  const count = num(r.review_count);
  const dq: DataQuality =
    r.data_quality === 'good' || r.data_quality === 'limited' || r.data_quality === 'none'
      ? r.data_quality
      : 'limited';
  const want = new Set(focuses);

  return {
    product_name: str(r.product_name, 160) || fallbackName || 'This product',
    verdict: str(r.verdict, 900) || 'We couldn’t form a clear overall picture from this page.',
    average_rating: rating === null ? null : Math.round(Math.min(5, Math.max(0, rating)) * 10) / 10,
    review_count: count === null ? null : Math.max(0, Math.round(count)),
    sentiment,
    love: want.has('love') ? themes(r.love) : [],
    complaints: want.has('complaints') ? themes(r.complaints) : [],
    wishes: want.has('wishes')
      ? objects(r.wishes)
          .map((x) => ({ idea: str(x.idea, 80), detail: str(x.detail, 300) }))
          .filter((x) => x.idea)
          .slice(0, 8)
      : [],
    buyers: want.has('buyers')
      ? objects(r.buyers)
          .map((x) => ({ type: str(x.type, 60), why: str(x.why, 240) }))
          .filter((x) => x.type)
          .slice(0, 8)
      : [],
    ads: want.has('ads')
      ? objects(r.ads)
          .map((x) => ({ headline: str(x.headline, 90), body: str(x.body, 260) }))
          .filter((x) => x.headline)
          .slice(0, 4)
      : [],
    answer: str(r.answer, 1500) || null,
    data_quality: dq,
    data_note: str(r.data_note, 300),
  };
}

export function normalizeFollowUp(raw: unknown): FollowUpAnswer {
  const r = isObj(raw) ? raw : {};
  const points = Array.isArray(r.points)
    ? r.points.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim().slice(0, 240))
    : [];
  return {
    answer: str(r.answer, 2000) || 'The reviews on this page don’t give a clear answer to that.',
    points: points.slice(0, 5),
  };
}
