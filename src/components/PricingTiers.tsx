import { useMemo, useState } from 'react';
import Reveal from './Reveal';
import { CREDIT_PACKS, PACK_ORDER, PROMPT_COST, formatCredits, formatPrice, type PackId } from '../../shared/types';

const starterPerCredit = CREDIT_PACKS.starter.price / CREDIT_PACKS.starter.credits;

export function packStats(id: PackId) {
  const p = CREDIT_PACKS[id];
  const searches = Math.floor(p.credits / PROMPT_COST);
  const perSearch = p.price / (p.credits / PROMPT_COST);
  const savings = Math.round((1 - p.price / p.credits / starterPerCredit) * 100);
  return { ...p, searches, perSearch, savings };
}

const money = (n: number) => formatPrice(Math.round(n * 100) / 100);

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-praise" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Props {
  onChoose: (pack: PackId) => void;
  loadingPack?: PackId | null;
  disabled?: boolean;
}

export default function PricingTiers({ onChoose, loadingPack = null, disabled = false }: Props) {
  const [perMonth, setPerMonth] = useState(40);
  const stats = useMemo(() => PACK_ORDER.map((id) => ({ id, ...packStats(id) })), []);
  const recommended: PackId = (stats.find((s) => s.searches >= perMonth * 3) ?? stats[stats.length - 1]).id;
  const maxPerSearch = stats[0].perSearch;

  return (
    <div>
      {/* Plan finder */}
      <Reveal className="glass spotlight rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:gap-10">
          <div className="md:w-80">
            <label htmlFor="usage" className="font-display text-xl font-semibold tracking-tight">
              How many prompts do you send a month?
            </label>
            <p className="mt-1 text-sm text-muted">Each product link or follow-up question is one prompt. We’ll suggest a pack that lasts about three months.</p>
          </div>
          <div className="flex-1">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-4xl font-medium tabular-nums">{perMonth}</span>
              <span className="label text-muted">
                about {formatCredits(perMonth * PROMPT_COST * 3)} credits for 3 months
              </span>
            </div>
            <input
              id="usage"
              type="range"
              min={5}
              max={250}
              step={5}
              value={perMonth}
              onChange={(e) => setPerMonth(Number(e.target.value))}
              className="mt-3 w-full accent-violet-400"
            />
            <p className="mt-2 text-sm">
              We suggest <span className="font-semibold">{CREDIT_PACKS[recommended].name}</span>.
            </p>
          </div>
        </div>
      </Reveal>

      {/* Tier cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((t, i) => {
          const featured = t.id === 'pro';
          const isRec = t.id === recommended;
          return (
            <Reveal key={t.id} delay={i * 90} className={`flex ${featured ? 'lg:-my-3' : ''}`}>
            <div
              className={`spotlight hover-lift flex w-full flex-col rounded-3xl p-6 ${
                featured ? 'glow-card text-white lg:py-9' : 'glass'
              } ${isRec ? 'ring-2 ring-cyan-300/80 shadow-[0_0_40px_-8px_rgba(103,232,249,0.6)]' : ''}`}
            >
              <div className="flex min-h-[28px] flex-wrap gap-1.5">
                {t.badge && (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${featured ? 'bg-white text-[#3a2a8c]' : 'bg-gold-soft text-gold-deep'}`}>
                    {t.badge}
                  </span>
                )}
                {isRec && (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${featured ? 'bg-cyan-300 text-night' : 'bg-cyan-300/90 text-night'}`}>
                    Suggested for you
                  </span>
                )}
              </div>

              <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight">{t.name}</h3>
              <p className={`mt-1 min-h-[40px] text-sm ${featured ? 'text-white/70' : 'text-muted'}`}>{t.bestFor}</p>

              <p className="mt-5 flex items-baseline gap-1.5">
                <span className="font-display text-5xl font-semibold tracking-[-0.05em]">{formatPrice(t.price)}</span>
                <span className={`text-sm ${featured ? 'text-white/60' : 'text-subtle'}`}>one-time</span>
              </p>
              <p className="label mt-1 text-[13px] font-medium">{t.credits.toLocaleString()} credits</p>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className={`label whitespace-nowrap rounded-full px-2.5 py-1 font-medium ${featured ? 'bg-white/15' : 'bg-white/[0.08]'}`}>
                  {money(t.perSearch)} per prompt
                </span>
                {t.savings > 0 && (
                  <span className={`label whitespace-nowrap rounded-full px-2.5 py-1 font-medium ${featured ? 'bg-emerald-300 text-night' : 'bg-praise/15 text-praise'}`}>
                    Save {t.savings}%
                  </span>
                )}
              </div>

              <ul className={`mt-5 flex-1 space-y-2.5 text-sm ${featured ? 'text-white/90' : ''}`}>
                <li className="flex gap-2">
                  <Check />
                  <span>
                    <span className="font-semibold">{t.searches.toLocaleString()}</span> prompts
                  </span>
                </li>
                <li className="flex gap-2">
                  <Check />
                  <span>Use them on product links or follow-ups</span>
                </li>
                <li className="flex gap-2">
                  <Check />
                  <span>All topics, including ad ideas</span>
                </li>
                <li className="flex gap-2">
                  <Check />
                  <span>Quick or detailed reports</span>
                </li>
                <li className="flex gap-2">
                  <Check />
                  <span>Credits never expire</span>
                </li>
              </ul>

              <button
                onClick={() => onChoose(t.id)}
                disabled={disabled || loadingPack !== null}
                className={`mt-6 rounded-full px-5 py-3 font-semibold transition-colors disabled:opacity-60 ${
                  featured ? 'bg-white text-[#3a2a8c] shadow-[0_0_24px_rgba(255,255,255,0.45)] transition-all hover:scale-[1.02] hover:bg-white/90 active:scale-[0.98]' : 'btn-primary'
                }`}
              >
                {loadingPack === t.id ? 'Opening Stripe…' : `Get ${t.name}`}
              </button>
            </div>
            </Reveal>
          );
        })}
      </div>

      {/* Value chart */}
      <Reveal className="mt-14 grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-center">
        <div>
          <h3 className="font-display text-3xl font-semibold leading-tight tracking-[-0.03em]">
            The bigger the pack, the less each prompt <span className="accent">costs.</span>
          </h3>
          <p className="mt-3 text-muted">
            Apex brings each prompt down to {money(stats[4].perSearch)}, a quarter of the Starter price. Same reports,
            same quality, just more of them.
          </p>
        </div>
        <div className="space-y-3" role="img" aria-label="Price per prompt for each pack">
          {stats.map((t) => (
            <div key={t.id} className="grid grid-cols-[64px_1fr_56px] items-center gap-3 text-sm">
              <span className="font-medium">{t.name}</span>
              <span className="h-7 overflow-hidden rounded-full bg-white/[0.08] ring-1 ring-white/10">
                <span
                  key={recommended}
                  className={`grow-x block h-full rounded-full transition-[width] duration-700 ${t.id === recommended ? 'bg-gradient-to-r from-cyan-300 to-sky-400 shadow-[0_0_18px_rgba(103,232,249,0.6)]' : 'bg-gradient-to-r from-blue-500 to-violet-500'}`}
                  style={{ width: `${(t.perSearch / maxPerSearch) * 100}%` }}
                />
              </span>
              <span className="text-right font-mono font-medium tabular-nums">{money(t.perSearch)}</span>
            </div>
          ))}
          <p className="label pt-1 text-subtle">Price per prompt (1.5 credits each)</p>
        </div>
      </Reveal>

      {/* Promises */}
      <Reveal className="glass spotlight mt-14 grid gap-6 rounded-3xl p-6 sm:grid-cols-2 sm:p-8 lg:grid-cols-4">
        {[
          ['Only pay for results', 'Blocked pages, errors and pages with no reviews never use credits.'],
          ['Credits never expire', 'Buy once and use them next week or next year.'],
          ['Pay your way', 'Card, Apple Pay, Google Pay or bank debit, processed securely by Stripe.'],
          ['Real reviews only', 'Every report comes from the page you share. Nothing is made up.'],
        ].map(([title, body]) => (
          <div key={title}>
            <p className="font-semibold">{title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </Reveal>

      <p className="mt-8 text-sm text-subtle">
        Every prompt uses {formatCredits(PROMPT_COST)} credits, whether it’s a new product link or a follow-up question.
      </p>
    </div>
  );
}
