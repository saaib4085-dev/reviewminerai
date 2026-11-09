import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CREDIT_PACKS, type VoucherOrder } from '../../shared/types';
import { api } from '../lib/api';
import { SITE } from '../lib/siteInfo';
import { wait } from '../lib/wait';
import Logo from './Logo';
import Receipt from './Receipt';

interface Props {
  /** The order the buyer is coming back to from Stripe's checkout (/checkout/success?order=…). */
  resumeOrderId: string;
  onClose: () => void;
  onCredits: (newCredits: number) => void;
}

type Step = 'waiting' | 'receipt' | 'failed';

export default function CheckoutPage({ resumeOrderId, onClose, onCredits }: Props) {
  const [step, setStep] = useState<Step>('waiting');
  const [error, setError] = useState<string | null>(null);
  const orderId = resumeOrderId;
  const [order, setOrder] = useState<VoucherOrder | null>(null);
  const [bankDebit, setBankDebit] = useState(false);
  const [phase, setPhase] = useState(1); // waiting page: 0 paid on Stripe, 1 confirming, 2 adding credits
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, step]);

  useEffect(() => {
    topRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  // Back from Stripe: our servers check with Stripe and Supabase until the payment is confirmed.
  useEffect(() => {
    if (step !== 'waiting' || !orderId) return;
    let stop = false;
    const started = Date.now();
    (async () => {
      await wait(900);
      for (let attempt = 0; !stop; attempt++) {
        try {
          const res = await api.verifyPayment({ orderId });
          if (stop) return;
          setOrder(res.order);
          if (res.order.methodLabel?.startsWith('SEPA')) setBankDebit(true);
          if (res.status === 'paid') {
            setPhase(2);
            if (res.newCredits !== null) onCredits(res.newCredits);
            await wait(Math.max(0, 2200 - (Date.now() - started)));
            if (!stop) setStep('receipt');
            return;
          }
          if (res.status === 'failed') {
            setError(res.message ?? 'The payment didn’t go through.');
            setStep('failed');
            return;
          }
          if (res.status === 'processing') setBankDebit(true);
          if (res.status === 'pending' && attempt > 40) {
            setError('We haven’t received a payment for this order. If you closed Stripe’s page before paying, you haven’t been charged.');
            setStep('failed');
            return;
          }
        } catch {
          /* temporary problem: keep trying */
        }
        await wait(bankDebit ? 15000 : attempt < 20 ? 2500 : 6000);
      }
    })();
    return () => {
      stop = true;
    };
  }, [step, orderId, bankDebit, onCredits]);

  const steps = ['Payment', 'Confirmation', 'Receipt'];
  const stepIndex = step === 'failed' ? 0 : step === 'waiting' ? 1 : 2;

  return createPortal(
    <div ref={topRef} className="app-bg fixed inset-0 z-[65] overflow-y-auto overscroll-contain animate-page-in" role="dialog" aria-modal="true" aria-label="Checkout" data-lenis-prevent>
      <header className="sticky top-0 z-10 border-b border-white/10 bg-night/40 backdrop-blur-xl print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <button onClick={onClose} className="rounded-full px-3 py-1.5 text-sm font-medium text-muted hover:bg-white/10 hover:text-ink disabled:opacity-30">
            {step === 'receipt' ? '✕ Close' : '← Back'}
          </button>
          <span className="mx-auto flex items-center gap-2 font-display font-semibold">
            <Logo className="h-6 w-6" /> {SITE.appName}
          </span>
          <span className="label rounded-full bg-emerald-300/10 px-3 py-1 text-emerald-200">🔒 Secure checkout by Stripe</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <ol className="mx-auto mb-10 flex max-w-md items-center gap-2 print:hidden" aria-label="Checkout progress">
          {steps.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold transition-all ${
                  i < stepIndex ? 'bg-emerald-300 text-night' : i === stepIndex ? 'btn-primary' : 'border border-white/25 text-white/50'
                }`}
              >
                {i < stepIndex ? '✓' : i + 1}
              </span>
              <span className={`text-sm ${i === stepIndex ? 'font-semibold text-white' : 'text-white/55'}`}>{label}</span>
              {i < steps.length - 1 && <span className={`h-px flex-1 ${i < stepIndex ? 'bg-emerald-300/60' : 'bg-white/15'}`} />}
            </li>
          ))}
        </ol>

        {/* ---------- Payment didn't go through ---------- */}
        {step === 'failed' && (
          <section className="glass mx-auto max-w-xl rounded-[2rem] p-8 text-center sm:p-10" role="alert">
            <p className="text-4xl" aria-hidden="true">⚠️</p>
            <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">The payment didn’t go through</h1>
            <p className="mt-3 text-white/75">{error ?? 'You haven’t been charged.'}</p>
            <button onClick={onClose} className="btn-primary mt-6 rounded-full px-8 py-3 font-semibold">
              Back to credit packs
            </button>
          </section>
        )}

        {/* ---------- 2. Waiting ---------- */}
        {step === 'waiting' && (
          <section className="glass mx-auto max-w-xl rounded-[2rem] p-8 text-center sm:p-12" aria-live="polite">
            <div className="relative mx-auto h-28 w-28" aria-hidden="true">
              <span className="absolute inset-0 rounded-full border-4 border-white/10" />
              <span className="absolute inset-0 rounded-full border-4 border-transparent border-r-violet-400 border-t-cyan-300 motion-safe:animate-spin" />
              <span className="absolute inset-3 rounded-full border-4 border-transparent border-b-fuchsia-400 motion-safe:animate-spin [animation-direction:reverse] [animation-duration:1.6s]" />
              <span className="absolute inset-0 grid place-items-center text-3xl">🔒</span>
            </div>
            <h1 className="mt-8 font-display text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
              Your transaction is currently being checked and <span className="accent">confirmed</span> by our servers
            </h1>
            <p className="mt-3 text-white/70">
              {bankDebit
                ? 'Bank debits (SEPA) take 3–5 business days to confirm. You can close this page: your credits are added automatically as soon as your bank confirms, and your receipt will be under Settings → Credits.'
                : 'This usually takes a few seconds. Please keep this page open.'}
            </p>
            <ol className="mx-auto mt-8 max-w-xs space-y-3 text-left text-sm">
              {['Paid on Stripe', bankDebit ? 'Waiting for your bank to confirm' : 'Confirming with Stripe', 'Adding credits to your account'].map((label, i) => (
                <li key={label} className={`flex items-center gap-3 ${i <= phase ? 'text-white' : 'text-white/45'}`}>
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full text-xs ${
                      i < phase ? 'bg-emerald-300 text-night' : i === phase ? 'border-2 border-cyan-300 motion-safe:animate-pulse' : 'border border-white/25'
                    }`}
                  >
                    {i < phase ? '✓' : ''}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
            {bankDebit && (
              <button onClick={onClose} className="mt-8 rounded-full border border-white/25 px-6 py-3 font-semibold hover:bg-white/10">
                Close and come back later
              </button>
            )}
          </section>
        )}

        {/* ---------- 3. Receipt ---------- */}
        {step === 'receipt' && order && (
          <div className="mx-auto max-w-xl text-center">
            <div className="animate-pop">
              <p className="text-4xl" aria-hidden="true">🎉</p>
              <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
                Payment <span className="accent">confirmed</span>
              </h1>
              <p className="mt-2 text-white/75">
                {order.credits.toLocaleString()} credits have been added to your account, and you’re now on the {CREDIT_PACKS[order.pack]?.name} tier or above.
              </p>
            </div>
            <div className="mt-8 animate-rise">
              <Receipt order={order} />
            </div>
            <p className="mx-auto mt-6 max-w-sm rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.07] px-4 py-3 text-sm text-cyan-50 print:hidden">
              📸 Take a photo or screenshot of this receipt to keep it. You can also find it any time under Settings → Credits.
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row print:hidden">
              <button onClick={() => window.print()} className="rounded-full border border-white/25 px-6 py-3 font-semibold hover:bg-white/10">
                Save as PDF / print
              </button>
              <button onClick={onClose} className="btn-primary rounded-full px-8 py-3 font-semibold">
                Start searching
              </button>
            </div>
          </div>
        )}
      </main>
    </div>,
    document.body,
  );
}
