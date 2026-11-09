import { LINK_COST, formatCredits } from '../../shared/types';
import { useAnimatedNumber } from '../lib/motion';

export default function CreditPill({ credits, onClick }: { credits: number | null; onClick: () => void }) {
  const low = credits !== null && credits < LINK_COST * 2;
  const shown = useAnimatedNumber(credits);
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add credits"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all duration-300 hover:scale-[1.04] active:scale-95 font-mono text-[13px] font-medium transition-colors ${
        low ? 'bg-gripe/10 text-gripe hover:bg-gripe/15' : 'bg-gold-soft text-gold-deep hover:bg-gold/20'
      }`}
    >
      <span aria-hidden="true">⚡</span>
      <span key={credits ?? 'none'} className="inline-block animate-pop tabular-nums">
        {shown === null ? '…' : `${formatCredits(shown)} ${credits === 1 ? 'credit' : 'credits'}`}
      </span>
    </button>
  );
}
