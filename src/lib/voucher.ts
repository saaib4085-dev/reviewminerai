// Picks up voucher links like https://your-site/?code=RM-ABCD-EFGH (or ?voucher=…).
//
// This runs before anything else loads (it's the first import in main.tsx) so that:
//  - the code is removed from the address bar straight away (refreshing can't re-send it), and
//  - Google sign-in, which also uses ?code= for its own one-time codes, never sees it.
// The code is kept in this tab until the person is signed in, then redeemed automatically.

import { normalizeVoucher } from '../../shared/types';

const KEY = 'review-miner:pending-voucher';

function capture(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let found: string | null = null;
  for (const param of ['voucher', 'code']) {
    const value = url.searchParams.get(param);
    const code = value ? normalizeVoucher(value) : null;
    // Only voucher-shaped values are touched; sign-in codes are left alone.
    if (code) {
      found = code;
      url.searchParams.delete(param);
    }
  }
  if (!found) return;
  try {
    sessionStorage.setItem(KEY, found);
  } catch {
    /* storage unavailable: the person can type the code in */
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

capture();

export function peekPendingVoucher(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function takePendingVoucher(): string | null {
  const code = peekPendingVoucher();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return code;
}

/** Tidies typing: capitals, letters, numbers and dashes only. */
export function formatVoucherInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-/, '')
    .slice(0, 40);
}
