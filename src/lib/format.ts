import { FOCUS_OPTIONS, type Analysis, type FocusKey } from '../../shared/types';

const URL_PATTERN =
  /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s<>"']*)/i;

/** Splits a chat message into a product link (if any) and the rest of the text. */
export function splitMessage(text: string): { url: string | null; rest: string } {
  const match = text.match(URL_PATTERN);
  if (!match) return { url: null, rest: text.trim() };
  const url = match[0].replace(/[),.;!?]+$/, '');
  const rest = text.replace(match[0], ' ').replace(/\s+/g, ' ').trim();
  return { url, rest };
}

/** Pulls every product link out of a message, keeping the rest as the question. */
export function extractUrls(text: string): { urls: string[]; rest: string } {
  const all = new RegExp(URL_PATTERN.source, 'gi');
  const urls: string[] = [];
  const rest = text
    .replace(all, (m) => {
      const u = m.replace(/[),.;!?]+$/, '');
      if (!urls.some((x) => x.toLowerCase() === u.toLowerCase())) urls.push(u);
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { urls, rest };
}

/** True when the whole value is a single link. */
export function isLink(value: string): boolean {
  const { urls, rest } = extractUrls(value.trim());
  return urls.length === 1 && rest === '';
}

export function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function focusLabel(key: FocusKey): string {
  const option = FOCUS_OPTIONS.find((o) => o.key === key);
  return option ? `${option.emoji} ${option.label}` : key;
}

/** Plain-text version of a report for the clipboard. */
export function reportToText(a: Analysis): string {
  const r = a.report;
  const lines: string[] = [`${r.product_name}`, a.url, ''];
  if (r.average_rating !== null) lines.push(`Rating: ${r.average_rating}/5${r.review_count ? ` from ${r.review_count} reviews` : ''}`);
  lines.push(`Overall: ${r.verdict}`);
  lines.push(`Mood: ${r.sentiment.positive}% happy, ${r.sentiment.neutral}% mixed, ${r.sentiment.negative}% unhappy`);
  if (r.answer) lines.push('', `Your question: ${a.question ?? ''}`, r.answer);
  const section = (title: string, items: string[]) => {
    if (items.length) lines.push('', title, ...items.map((i) => `- ${i}`));
  };
  section('What people love', r.love.map((t) => `${t.theme}: ${t.detail}`));
  section('Common complaints', r.complaints.map((t) => `${t.theme}: ${t.detail}`));
  section('What they wish it had', r.wishes.map((w) => `${w.idea}: ${w.detail}`));
  section('Who’s buying it', r.buyers.map((b) => `${b.type}: ${b.why}`));
  section('Ad ideas', r.ads.map((ad) => `${ad.headline} | ${ad.body}`));
  return lines.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
