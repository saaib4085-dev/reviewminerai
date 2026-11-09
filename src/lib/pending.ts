// Remembers a prompt typed on the home page so it runs right after sign-in
// (survives the Google sign-in redirect because it lives in sessionStorage).
import { FOCUS_KEYS, type FocusKey } from '../../shared/types';

const KEY = 'review-miner:pending-prompt';

export function savePendingPrompt(text: string, focuses: FocusKey[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ text, focuses }));
  } catch {
    /* storage unavailable: the user can paste the link again */
  }
}

export function takePendingPrompt(): { text: string; focuses: FocusKey[] } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as { text?: unknown; focuses?: unknown };
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) return null;
    const focuses = Array.isArray(parsed.focuses) ? FOCUS_KEYS.filter((k) => (parsed.focuses as unknown[]).includes(k)) : [];
    return { text: parsed.text, focuses };
  } catch {
    return null;
  }
}

const PACK_KEY = 'review-miner:pending-pack';
const PACKS = ['starter', 'core', 'pro', 'elite', 'apex'] as const;

/** A tier clicked on the home page before signing up: we go to Stripe for it right after sign-up. */
export function savePendingPack(pack: string): void {
  try {
    sessionStorage.setItem(PACK_KEY, pack);
  } catch {
    /* storage unavailable */
  }
}

export function takePendingPack(): (typeof PACKS)[number] | null {
  try {
    const v = sessionStorage.getItem(PACK_KEY);
    sessionStorage.removeItem(PACK_KEY);
    return (PACKS as readonly string[]).includes(v ?? '') ? (v as (typeof PACKS)[number]) : null;
  } catch {
    return null;
  }
}
