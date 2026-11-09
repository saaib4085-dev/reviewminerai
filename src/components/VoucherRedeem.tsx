import { useEffect, useRef, useState, type FormEvent } from 'react';
import { normalizeVoucher, type RedeemResponse } from '../../shared/types';
import { api, toApiError } from '../lib/api';
import { formatVoucherInput } from '../lib/voucher';

interface Props {
  /** Pre-fills the box (for example from a ?code= link). */
  initialCode?: string | null;
  /** Redeem the pre-filled code straight away. */
  autoRedeem?: boolean;
  onRedeemed: (result: RedeemResponse) => void;
  variant?: 'hero' | 'compact';
}

export default function VoucherRedeem({ initialCode = null, autoRedeem = false, onRedeemed, variant = 'hero' }: Props) {
  const [code, setCode] = useState(initialCode ? formatVoucherInput(initialCode) : '');
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const autoDone = useRef(false);

  async function redeem(raw: string) {
    const normalized = normalizeVoucher(raw);
    if (!normalized) {
      setState('error');
      setMessage('That doesn’t look like a voucher code. Check it and try again.');
      return;
    }
    setState('loading');
    setMessage(null);
    try {
      const res = await api.redeem({ code: normalized });
      setState('success');
      setMessage(
        res.tierUpgraded
          ? `${res.creditsAdded.toLocaleString()} credits added, and you’re now an ${res.newTier} Member! 🎉`.replace(/an (?=[^AEIOU])/, 'a ')
          : `${res.creditsAdded.toLocaleString()} credits added successfully!`,
      );
      setCode('');
      onRedeemed(res);
    } catch (err) {
      setState('error');
      setMessage(toApiError(err).message);
    }
  }

  useEffect(() => {
    if (autoRedeem && initialCode && !autoDone.current) {
      autoDone.current = true;
      void redeem(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRedeem, initialCode]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (state !== 'loading') void redeem(code);
  }

  const hero = variant === 'hero';

  return (
    <form onSubmit={submit} className={hero ? 'glass spotlight rounded-3xl p-6 sm:p-8' : ''} noValidate>
      {hero && (
        <div className="mb-5 flex items-start gap-4">
          <span
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/20 bg-gradient-to-br from-cyan-300/30 to-violet-500/30 text-2xl shadow-[0_0_24px_-6px_rgba(103,232,249,0.7)]"
          >
            🎟️
          </span>
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Redeem a <span className="accent">voucher</span>
            </h2>
            <p className="mt-1 text-muted">Got a code? Enter it below. Its credits are added straight away, and some codes also upgrade your tier.</p>
          </div>
        </div>
      )}

      <label htmlFor={`voucher-${variant}`} className={hero ? 'sr-only' : 'mb-2 block font-semibold'}>
        {hero ? 'Voucher code' : 'Redeem a voucher'}
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id={`voucher-${variant}`}
          value={code}
          onChange={(e) => {
            setCode(formatVoucherInput(e.target.value));
            if (state !== 'loading') {
              setState('idle');
              setMessage(null);
            }
          }}
          placeholder="e.g. APEX-1000-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          disabled={state === 'loading'}
          aria-invalid={state === 'error'}
          aria-describedby={message ? `voucher-msg-${variant}` : undefined}
          className={`h-12 min-w-0 flex-1 rounded-2xl border bg-white/[0.06] px-4 font-mono text-lg tracking-[0.12em] text-white placeholder:text-white/30 transition-all focus:outline-none disabled:opacity-60 ${
            state === 'error'
              ? 'border-rose-300/60'
              : state === 'success'
                ? 'border-emerald-300/60'
                : 'border-white/20 focus:border-cyan-300/70 focus:shadow-[0_0_24px_-6px_rgba(103,232,249,0.7)]'
          }`}
        />
        <button
          type="submit"
          disabled={state === 'loading' || !code}
          className="btn-primary inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 font-semibold"
        >
          {state === 'loading' ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white motion-safe:animate-spin" aria-hidden="true" />
              Redeeming…
            </>
          ) : (
            'Redeem'
          )}
        </button>
      </div>

      {message && (
        <p
          id={`voucher-msg-${variant}`}
          role={state === 'error' ? 'alert' : 'status'}
          className={`mt-3 animate-pop text-sm font-medium ${state === 'error' ? 'text-rose-200' : 'text-emerald-200'}`}
        >
          {state === 'success' ? '✓ ' : ''}
          {message}
        </p>
      )}
      {hero && !message && <p className="label mt-3 text-subtle">Each code works once. Codes never use 0, O, 1 or I, so they’re easy to type.</p>}
    </form>
  );
}
