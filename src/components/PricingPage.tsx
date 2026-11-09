import { useEffect, useState } from 'react';
import { LINK_COST, TERMS_VERSION, formatCredits, type PackId } from '../../shared/types';
import { api, toApiError } from '../lib/api';
import type { RedeemResponse } from '../../shared/types';
import CreditPill from './CreditPill';
import Logo from './Logo';
import PricingTiers from './PricingTiers';
import VoucherRedeem from './VoucherRedeem';

interface Props {
  credits: number | null;
  onClose: () => void;
  voucher?: string | null;
  onRedeemed: (result: RedeemResponse) => void;
  /** Start buying this pack straight away (e.g. chosen on the home page before signing up). */
  autoBuy?: PackId | null;
}

export default function PricingPage({ credits, onClose, voucher = null, onRedeemed, autoBuy = null }: Props) {
  const [loading, setLoading] = useState<PackId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One click: straight to Stripe's checkout page for that pack.
  async function buy(pack: PackId) {
    if (loading) return;
    setError(null);
    setLoading(pack);
    try {
      const res = await api.createPayment({ pack, termsVersion: TERMS_VERSION });
      window.location.assign(res.url); // Stripe's hosted checkout page
    } catch (e) {
      setError(toApiError(e).message);
      setLoading(null);
    }
  }

  useEffect(() => {
    if (autoBuy) void buy(autoBuy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const outOfCredits = credits !== null && credits < LINK_COST;

  return (
    <div className="app-bg fixed inset-0 z-50 overflow-y-auto overscroll-contain scroll-smooth animate-page-in" data-lenis-prevent role="dialog" aria-modal="true" aria-label="Pricing">
      <header className="sticky top-0 z-10 border-b border-line bg-night/40 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <button onClick={onClose} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted hover:bg-white/10 hover:text-ink">
            <span aria-hidden="true">←</span> Back to chats
          </button>
          <span className="mx-auto hidden items-center gap-2 font-display font-semibold sm:flex">
            <Logo className="h-6 w-6" /> Review Miner
          </span>
          <CreditPill credits={credits} onClick={() => undefined} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-20 pt-12 sm:px-6 sm:pt-16">
        <h1 className="max-w-3xl font-display text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-6xl">
          Get more answers <span className="accent">for less.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          {outOfCredits
            ? `You have ${formatCredits(credits ?? 0)} credits, and each prompt needs ${formatCredits(LINK_COST)}. Pick a pack to keep going.`
            : 'Pay once on Stripe’s secure checkout: card, Apple Pay, Google Pay or bank debit. No subscription. Your credits are added the moment the payment is confirmed.'}
        </p>


        <div className="mt-10 max-w-3xl">
          <VoucherRedeem initialCode={voucher} autoRedeem={!!voucher} onRedeemed={onRedeemed} />
        </div>

        <div className="mt-16">
          {error && (
            <p className="mb-6 rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100" role="alert">
              {error}
            </p>
          )}
          <PricingTiers onChoose={(p) => void buy(p)} loadingPack={loading} />
          <p className="label mt-6 text-center text-white/55">🔒 You’ll pay on Stripe’s secure checkout page and come straight back with your credits.</p>
        </div>

      </main>

    </div>
  );
}
