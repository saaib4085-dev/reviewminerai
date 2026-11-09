import { HttpError } from './http';

export interface ScrapedPage {
  markdown: string;
  title: string | null;
}

interface FirecrawlResponse {
  success?: boolean;
  error?: string;
  data?: { markdown?: string; metadata?: { title?: string } };
}

export async function scrapePage(url: string, apiKey: string): Promise<ScrapedPage> {
  let res: Response;
  try {
    res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, timeout: 45000 }),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new HttpError(
      504,
      'SCRAPE_TIMEOUT',
      'That page took too long to open. Try again, or try a different link. No credit was used.',
    );
  }

  const body = (await res.json().catch(() => null)) as FirecrawlResponse | null;

  if (!res.ok || !body?.success) {
    console.error('Firecrawl error', res.status, body?.error);
    if (res.status === 402 || res.status === 429) {
      throw new HttpError(
        503,
        'SCRAPE_BUSY',
        'Our page reader is busy right now. Please try again in a minute. No credit was used.',
      );
    }
    throw new HttpError(
      502,
      'SCRAPE_FAILED',
      'We couldn’t open that page. Some stores block automatic readers. Try the product’s reviews page or a different store. No credit was used.',
    );
  }

  const markdown = String(body.data?.markdown ?? '').trim();
  if (markdown.length < 200) {
    throw new HttpError(
      422,
      'EMPTY_PAGE',
      'That page didn’t have enough text to read. Try linking straight to the product page. No credit was used.',
    );
  }

  return { markdown, title: body.data?.metadata?.title?.trim() || null };
}
