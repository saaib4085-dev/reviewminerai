import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, toApiError } from '../lib/api';
import { SITE } from '../lib/siteInfo';
import Logo from './Logo';

interface Props {
  orderId: string;
  /** The order turned out to be paid (e.g. paid in another tab): show the success page instead. */
  onPaidInstead: () => void;
  onChoosePack: () => void;
  onClose: () => void;
}

/** /checkout/cancelled: the buyer left Stripe's checkout without paying. */
export default function CheckoutCancelled({ orderId, onPaidInstead, onChoosePack, onClose }: Props) {
  const [state, setState] = useState<'closing' | 'cancelled' | 'error'>('closing');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Close the Stripe checkout on the server, so it can't be paid later by accident.
    api
      .cancelPayment({ orderId })
      .then((res) => {
        if (!alive) return;
        if (res.status === 'paid') onPaidInstead();
        else setState('cancelled');
      })
      .catch((e) => {
        if (!alive) return;
        setError(toApiError(e).message);
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, [orderId, onPaidInstead]);

  useEffect(() => {
    document.title = `Payment cancelled · ${SITE.appName}`;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      document.title = SITE.appName;
    };
  }, []);

  return createPortal(
    <div className="app-bg fixed inset-0 z-[65] overflow-y-auto animate-page-in" role="dialog" aria-modal="true" aria-label="Payment cancelled">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-night/40 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <span className="flex items-center gap-2 font-display font-semibold">
            <Logo className="h-6 w-6" /> {SITE.appName}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-20 pt-16 sm:px-6">
        <section className="glass rounded-[2rem] p-8 text-center sm:p-12" aria-live="polite">
          {state === 'closing' ? (
            <>
              <div className="mx-auto h-12 w-12 rounded-full border-4 border-white/15 border-t-cyan-300 motion-safe:animate-spin" aria-hidden="true" />
              <p className="mt-6 text-white/75">Closing your checkout…</p>
            </>
          ) : (
            <>
              <p className="text-4xl" aria-hidden="true">↩️</p>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">
                Payment <span className="accent">cancelled</span>
              </h1>
              <p className="mt-3 text-white/75">
                {state === 'error'
                  ? `You haven’t been charged. ${error ?? ''}`
                  : 'You haven’t been charged, and that checkout has been closed. You can choose a pack again whenever you like.'}
              </p>
              <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
                <button onClick={onChoosePack} className="btn-primary rounded-full px-7 py-3 font-semibold">
                  Back to credit packs
                </button>
                <button onClick={onClose} className="rounded-full border border-white/25 px-7 py-3 font-semibold hover:bg-white/10">
                  Back to my chats
                </button>
              </div>
            </>
          )}
        </section>
      </main>
    </div>,
    document.body,
  );
}
