import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import GoogleButton from './GoogleButton';
import Logo from './Logo';
import Modal from './Modal';
import { PRIVACY_HREF, TERMS_HREF } from '../lib/siteInfo';

export default function AuthModal({ onClose, intent }: { onClose: () => void; intent: 'login' | 'signup' }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setError('Enter a valid email address, like you@example.com.');
      return;
    }
    setStatus('sending');
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: value,
      options: { emailRedirectTo: window.location.origin },
    });
    if (authError) {
      setStatus('idle');
      setError(
        authError.status === 429
          ? 'Too many tries. Wait a minute, then try again.'
          : 'We couldn’t send the email. Check the address and try again.',
      );
      return;
    }
    setStatus('sent');
  }

  return (
    <Modal title={intent === 'signup' ? 'Create your account' : 'Log in'} onClose={onClose}>
      <div className="flex items-center gap-2 text-sm text-muted">
        <Logo className="h-5 w-5" />
        {intent === 'signup' ? 'New accounts get 15 free credits, enough for 10 product links.' : 'Welcome back to Review Miner.'}
      </div>

      {status === 'sent' ? (
        <div className="mt-6 rounded-2xl bg-white/[0.07] p-5 ring-1 ring-white/10" role="status">
          <p className="font-semibold">Check your inbox</p>
          <p className="mt-1 text-sm text-muted">
            We sent a sign-in link to <span className="font-medium text-ink">{email.trim()}</span>. Open it on this device to continue.
          </p>
          <button onClick={() => setStatus('idle')} className="mt-4 text-sm font-semibold underline underline-offset-2">
            Use a different email
          </button>
        </div>
      ) : (
        <>
          <GoogleButton
            label={intent === 'signup' ? 'Sign up with Google' : 'Log in with Google'}
            className="mt-6 w-full"
            onError={setError}
          />
          <p className="label mt-2 text-center text-subtle">
            {intent === 'signup' ? 'One click. Your account is created automatically.' : 'New here? This creates your account too.'}
          </p>

          <div className="my-5 flex items-center gap-3 text-xs text-subtle">
            <span className="h-px flex-1 bg-line" />
            or sign up with email
            <span className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={submit} noValidate>
            <label htmlFor="auth-email" className="sr-only">
              Email address
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-full border border-line-strong bg-white/[0.06] px-5 py-3 placeholder:text-subtle focus:border-violet-300 focus:outline-none"
              aria-invalid={!!error}
            />
            <button
              type="submit"
              disabled={status !== 'idle'}
              className="mt-3 w-full rounded-full btn-primary px-5 py-3 font-semibold text-white transition-colors disabled:opacity-60"
            >
              {status === 'sending' ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
          </form>
          {error && (
            <p className="mt-3 text-sm text-gripe" role="alert">
              {error}
            </p>
          )}
          <p className="mt-4 text-center text-xs text-subtle">
            No password needed. By continuing you agree to our{' '}
            <a href={TERMS_HREF} className="underline underline-offset-2 hover:text-ink">
              Terms
            </a>{' '}
            and{' '}
            <a href={PRIVACY_HREF} className="underline underline-offset-2 hover:text-ink">
              Privacy Policy
            </a>
            .
          </p>
        </>
      )}
    </Modal>
  );
}
