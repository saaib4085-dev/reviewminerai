import { useState } from 'react';
import { hostOf, timeAgo } from '../lib/format';
import type { ChatSummary } from './Workspace';
import CreditPill from './CreditPill';
import TierBadge from './TierBadge';
import type { Tier } from '../../shared/types';
import Logo from './Logo';
import { ADMIN_HREF } from '../lib/siteInfo';

interface Props {
  chats: ChatSummary[];
  historyState: 'loading' | 'ready' | 'error';
  activeKey: string | null;
  credits: number | null;
  tier: Tier;
  email: string | undefined;
  onNew: () => void;
  onOpen: (chat: ChatSummary) => void;
  onRemove: (chat: ChatSummary) => Promise<void>;
  onBuy: () => void;
  onSettings: () => void;
  onRetryHistory: () => void;
  onCollapse?: () => void;
  isAdmin?: boolean;
}

function HistoryRow({
  item,
  active,
  onOpen,
  onRemove,
}: {
  item: ChatSummary;
  active: boolean;
  onOpen: () => void;
  onRemove: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const title = item.title;

  if (confirming) {
    return (
      <div className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-line">
        <p className="text-sm">{item.example ? 'Hide the example chat?' : 'Close and remove this chat?'}</p>
        <div className="mt-2 flex gap-2">
          <button
            disabled={removing}
            onClick={async () => {
              setRemoving(true);
              await onRemove();
              setRemoving(false);
              setConfirming(false);
            }}
            className="rounded-full bg-gripe px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {removing ? 'Removing…' : item.example ? 'Hide' : 'Remove'}
          </button>
          <button onClick={() => setConfirming(false)} className="rounded-full px-3 py-1 text-xs font-semibold text-muted hover:text-ink">
            Keep
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`group relative rounded-xl transition-colors transition-all duration-300 hover:translate-x-0.5 ${active ? 'bg-white/[0.12] ring-1 ring-white/20 shadow-[0_0_18px_-6px_rgba(130,120,255,0.7)]' : 'hover:bg-white/[0.06]'}`}>
      <button onClick={onOpen} aria-current={active ? 'page' : undefined} className="block w-full px-3 py-2 pr-9 text-left">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          {item.example && (
            <span className="label shrink-0 rounded-full bg-violet-300/15 px-1.5 py-0.5 text-[10px] text-violet-200">Example</span>
          )}
          {item.count > 1 && (
            <span className="label shrink-0 rounded-full bg-cyan-300/15 px-1.5 py-0.5 text-[10px] text-cyan-200">+{item.count - 1}</span>
          )}
        </span>
        <span className="label block truncate text-[11px] text-subtle">
          {item.example ? 'Sample report, free to open' : `${item.count > 1 ? `${item.count} products` : hostOf(item.url)}, ${timeAgo(item.created_at)}`}
        </span>
      </button>
      <button
        onClick={() => setConfirming(true)}
        aria-label={`Close chat: ${title}`}
        title="Close chat"
        className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-subtle opacity-100 hover:bg-white/10 hover:text-ink focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

export default function Sidebar(p: Props) {
  return (
    <div className="flex h-full flex-col border-r border-white/10 bg-white/[0.05] backdrop-blur-2xl">
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-2">
          <Logo className="h-7 w-7" />
          <span className="font-display text-lg font-semibold tracking-tight">Review<span className="accent text-xl"> Miner</span></span>
        </div>
        {p.onCollapse && (
          <button onClick={p.onCollapse} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-canvas hover:text-ink" aria-label="Close menu">
            ✕
          </button>
        )}
      </div>

      <div className="px-3 pt-4">
        <button
          onClick={p.onNew}
          className="flex w-full items-center gap-2 rounded-full btn-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          <span className="text-lg leading-none" aria-hidden="true">+</span>
          New chat
        </button>
      </div>

      <nav className="thin-scroll mt-5 flex-1 overflow-y-auto px-2" aria-label="Your chats">
        <p className="label px-3 pb-1.5 text-subtle">Your chats</p>
        {p.historyState === 'loading' && (
          <div className="space-y-2 px-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-11" />
            ))}
          </div>
        )}
        {p.historyState === 'error' && (
          <p className="px-3 text-sm text-muted">
            Couldn’t load your chats.{' '}
            <button onClick={p.onRetryHistory} className="font-semibold text-ink underline underline-offset-2">
              Try again
            </button>
          </p>
        )}
        {p.historyState === 'ready' && p.chats.length === 0 && (
          <p className="px-3 text-sm text-subtle">Your chats will show up here.</p>
        )}
        {p.historyState === 'ready' && (
          <div className="stagger space-y-0.5">
            {p.chats.map((c) => (
              <HistoryRow
                key={c.key}
                item={c}
                active={p.activeKey === c.key}
                onOpen={() => p.onOpen(c)}
                onRemove={() => p.onRemove(c)}
              />
            ))}
          </div>
        )}
      </nav>

      <div className="space-y-2 border-t border-line p-3">
        <div className="flex flex-wrap items-center gap-2 px-1">
          <TierBadge tier={p.tier} />
          <CreditPill credits={p.credits} onClick={p.onBuy} />
          <button onClick={p.onBuy} className="ml-auto text-sm font-semibold underline-offset-2 hover:underline">
            Add credits
          </button>
        </div>
        {p.isAdmin && (
          <a
            href={ADMIN_HREF}
            className="flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.07] px-3 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-300/[0.14]"
          >
            <span aria-hidden="true">📈</span> Sales and payments
          </a>
        )}
        <button
          onClick={p.onSettings}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.08]"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full btn-primary text-sm font-semibold uppercase text-white">
            {(p.email ?? '?').charAt(0)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{p.email}</span>
            <span className="label block text-[11px] text-subtle">Settings</span>
          </span>
          <svg viewBox="0 0 20 20" className="h-5 w-5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="10" cy="10" r="2.5" />
            <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
