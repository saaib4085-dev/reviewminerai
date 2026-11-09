import { supabase } from '../lib/supabase';

/**
 * Signs in with Google. New users get an account (and their 15 free credits)
 * automatically the first time, so this is also "Sign up with Google".
 * Returns an error message, or null if the redirect to Google started.
 */
export async function signInWithGoogle(): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (!error) return null;
  console.error('Google sign-in could not start:', error.message);
  return /provider is not enabled|unsupported provider/i.test(error.message)
    ? 'Google sign-up isn’t switched on yet. Please use your email for now.'
    : 'Google sign-up isn’t available right now. Please use your email instead.';
}

/**
 * After coming back from Google, reads any error Google or Supabase put in the
 * address bar, removes it (and the one-time sign-in code) from the URL, and
 * returns a friendly message to show.
 */
export function takeAuthRedirectError(): string | null {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '');
  const code = url.searchParams.get('error') ?? hash.get('error');
  const description = url.searchParams.get('error_description') ?? hash.get('error_description');

  if (!code && !description) return null;

  for (const key of ['error', 'error_code', 'error_description']) {
    url.searchParams.delete(key);
    hash.delete(key);
  }
  const rest = hash.toString();
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${rest ? `#${rest}` : ''}`);

  if (code === 'access_denied' && !/signups? not allowed/i.test(description ?? '')) {
    return 'Google sign-up was cancelled. You can try again any time.';
  }
  console.error('Sign-in redirect error:', code, description);
  return 'Google sign-up didn’t finish. Please try again, or use your email instead.';
}

/** Removes the one-time "?code=…" left in the address bar after a successful sign-in. */
export function cleanAuthCodeFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('code')) return;
  url.searchParams.delete('code');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
