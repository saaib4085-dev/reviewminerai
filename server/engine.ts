// ReviewMiner's review engine: your system prompt, the user message, and the conversion of the
// engine's JSON into the shape the React dashboard renders (shared/types.ts → Report).
import type { DataQuality, FocusKey, Frequency, Report, ThemeItem } from '../shared/types';

/** The system prompt, exactly as configured. */
export const ENGINE_SYSTEM_PROMPT = `<system_role>
You are the customer intelligence engine for ReviewMiner. Your job is to research, scrape, and analyze product and business reviews across the web, returning structured JSON that directly populates the ReviewMiner React dashboard components.
</system_role>

<instructions>
1. Use web search to gather up-to-date, real customer reviews for the provided URL or product.
2. Extract executive sentiment split, verified buyer quote highlights, major complaints, requested missing features, buyer personas, and high-converting marketing hooks.
3. Output ONLY a raw, valid JSON object following the <output_schema> below.
4. Do NOT include markdown code blocks (\`\`\`json), preambles, or postscript notes.
</instructions>

<output_schema>
{
  "short_version": "Executive summary of what buyers say...",
  "sentiment": { "happy": 74, "mixed": 14, "unhappy": 12 },
  "qa": { "question": "Is it worth it for a small kitchen?", "answer": "Mostly yes..." },
  "what_people_love": [{ "title": "Boils really fast", "description": "...", "quote": "...", "volume": "Lots of people" }],
  "common_complaints": [{ "title": "Lid starts sticking", "description": "...", "quote": "...", "volume": "Some people" }],
  "what_they_wish_it_had": [{ "title": "Option to mute the beep", "description": "..." }],
  "whos_buying_it": [{ "tag": "Tea lovers", "description": "..." }],
  "ad_ideas": [{ "headline": "Tea in three minutes flat", "body": "..." }]
}
</output_schema>`;

const MAX_PAGE_CHARS = 30000;

/** The user message: the link, the user's question, and the product page text when we could read it. */
export function buildEngineUserMessage(url: string, question: string | null, page: { title: string | null; markdown: string } | null): string {
  const lines = [
    `Product URL: ${url}`,
    question ? `User's question: ${question}` : 'User\'s question: none (set "qa" to null).',
    '',
    'Also add these keys to the same JSON object if you can find them: "product_name" (string), "average_rating" (number 0-5 or null), "review_count" (integer or null).',
  ];
  if (page) {
    const text = page.markdown.length > MAX_PAGE_CHARS ? `${page.markdown.slice(0, MAX_PAGE_CHARS)}\n[page shortened]` : page.markdown;
    lines.push(
      '',
      `Here is the text of the product page${page.title ? ` ("${page.title}")` : ''}, already fetched for you. Use its reviews first, and web search for more:`,
      '<page>',
      text,
      '</page>',
    );
  } else {
    lines.push('', 'The product page could not be fetched directly, so rely on web search for reviews of this product.');
  }
  return lines.join('\n');
}

// ---------- engine JSON → dashboard Report ----------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(/[,%]/g, '')))) return Number(v.replace(/[,%]/g, ''));
  return null;
};
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** "Lots of people" → many, "Some people" → some, "A few people" → few. */
function volume(v: unknown): Frequency {
  const s = str(v).toLowerCase();
  if (s === 'many' || s === 'some' || s === 'few') return s;
  if (/(lots|many|most|majority|very common|frequent)/.test(s)) return 'many';
  if (/(few|couple|handful|rare|occasional|minority)/.test(s)) return 'few';
  return 'some';
}

function themes(v: unknown): ThemeItem[] {
  return list(v)
    .map((x) => ({
      theme: str(x.title ?? x.theme, 80),
      detail: str(x.description ?? x.detail, 300),
      frequency: volume(x.volume ?? x.frequency),
      quote: str(x.quote, 220).replace(/^["“]|["”]$/g, '') || null,
    }))
    .filter((t) => t.theme)
    .slice(0, 10);
}

export function engineToReport(raw: unknown, fallbackName: string | null, focuses: FocusKey[], question: string | null): Report {
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.sentiment) ? r.sentiment : {};
  const pos = Math.max(0, num(s.happy ?? s.positive) ?? 0);
  const neu = Math.max(0, num(s.mixed ?? s.neutral) ?? 0);
  const neg = Math.max(0, num(s.unhappy ?? s.negative) ?? 0);
  const total = pos + neu + neg;
  let sentiment = { positive: 0, neutral: 100, negative: 0 };
  if (total > 0) {
    const p = Math.round((pos / total) * 100);
    const n = Math.round((neg / total) * 100);
    sentiment = { positive: p, negative: n, neutral: Math.max(0, 100 - p - n) };
  }

  const want = new Set(focuses);
  const love = themes(r.what_people_love ?? r.love);
  const complaints = themes(r.common_complaints ?? r.complaints);
  const wishes = list(r.what_they_wish_it_had ?? r.wishes)
    .map((x) => ({ idea: str(x.title ?? x.idea, 80), detail: str(x.description ?? x.detail, 300) }))
    .filter((x) => x.idea)
    .slice(0, 8);
  const buyers = list(r.whos_buying_it ?? r.buyers)
    .map((x) => ({ type: str(x.tag ?? x.type, 60), why: str(x.description ?? x.why, 240) }))
    .filter((x) => x.type)
    .slice(0, 8);
  const ads = list(r.ad_ideas ?? r.ads)
    .map((x) => ({ headline: str(x.headline, 90), body: str(x.body, 260) }))
    .filter((x) => x.headline)
    .slice(0, 4);

  const qa = isObj(r.qa) ? r.qa : null;
  const verdict = str(r.short_version ?? r.verdict, 900);
  const rating = num(r.average_rating);
  const count = num(r.review_count);

  const findings = love.length + complaints.length;
  const dataQuality: DataQuality = !verdict && findings === 0 ? 'none' : findings < 2 ? 'limited' : 'good';

  return {
    product_name: str(r.product_name, 160) || fallbackName || 'This product',
    verdict: verdict || 'We couldn’t form a clear overall picture from the reviews we found.',
    average_rating: rating === null ? null : Math.round(Math.min(5, Math.max(0, rating)) * 10) / 10,
    review_count: count === null ? null : Math.max(0, Math.round(count)),
    sentiment,
    love: want.has('love') ? love : [],
    complaints: want.has('complaints') ? complaints : [],
    wishes: want.has('wishes') ? wishes : [],
    buyers: want.has('buyers') ? buyers : [],
    ads: want.has('ads') ? ads : [],
    answer: question ? str(qa?.answer, 1500) || null : null,
    data_quality: dataQuality,
    data_note:
      count !== null
        ? `Based on about ${Math.round(count).toLocaleString('en')} reviews, plus what we found on the web.`
        : 'Based on customer reviews found on the product page and across the web.',
  };
}
