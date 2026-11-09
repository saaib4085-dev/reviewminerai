import type { Tier } from '../../shared/types';

const STYLES: Record<Tier, { cls: string; icon: string }> = {
  Free: { cls: 'border-white/20 bg-white/[0.06] text-white/75', icon: '○' },
  Starter: { cls: 'border-sky-300/40 bg-sky-400/15 text-sky-100', icon: '✦' },
  Core: { cls: 'border-teal-300/40 bg-teal-400/15 text-teal-100', icon: '◆' },
  Pro: { cls: 'border-violet-300/50 bg-violet-500/20 text-violet-100 shadow-[0_0_16px_-6px_rgba(167,139,250,0.9)]', icon: '★' },
  Elite: {
    cls: 'border-fuchsia-300/50 bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-fuchsia-50 shadow-[0_0_18px_-6px_rgba(232,121,249,0.9)]',
    icon: '✸',
  },
  Apex: {
    cls: 'border-amber-200/70 bg-gradient-to-r from-amber-300/35 via-yellow-200/25 to-amber-400/35 text-amber-50 shadow-[0_0_22px_-4px_rgba(252,211,77,0.9)]',
    icon: '♛',
  },
};

/** "Apex Member" style badge for the user's account tier. */
export default function TierBadge({ tier, size = 'sm' }: { tier: Tier; size?: 'sm' | 'lg' }) {
  const s = STYLES[tier] ?? STYLES.Free;
  return (
    <span
      title={`${tier} member`}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold ${s.cls} ${
        size === 'lg' ? 'px-4 py-1.5 text-base' : 'px-2.5 py-1 text-xs'
      }`}
    >
      <span aria-hidden="true">{s.icon}</span>
      {tier} Member
    </span>
  );
}
