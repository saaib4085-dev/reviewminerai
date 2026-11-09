import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CREDIT_PACKS,
  TIERS,
  formatCredits,
  formatPrice,
  type AdminOrder,
  type AdminStatsResponse,
  type AdminTransaction,
  type AdminUser,
  type AdminUserDetailResponse,
  type Tier,
} from '../../shared/types';
import { api, toApiError } from '../lib/api';
import { timeAgo } from '../lib/format';
import { HOME_HREF } from '../lib/siteInfo';
import CopyButton from './CopyButton';
import Logo from './Logo';
import SystemCheck from './SystemCheck';
import TierBadge from './TierBadge';
import Toast from './Toast';

type Tab = 'overview' | 'users' | 'payments' | 'transactions' | 'system';

const REASON_LABELS: Record<string, string> = {
  signup_bonus: 'Sign-up bonus',
  analysis: 'Search',
  follow_up: 'Follow-up',
  purchase: 'Purchase',
  refund: 'Refund',
  voucher: 'Voucher',
  admin_adjustment: 'Admin change',
};

const input =
  'h-11 rounded-2xl border border-white/20 bg-white/[0.06] px-4 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/70 focus:outline-none';

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-3xl p-5 ${className}`}>{children}</div>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <p className="label text-white/55">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-white/55">{hint}</p>}
    </Card>
  );
}

function Amount({ value }: { value: number }) {
  return (
    <span className={`font-mono font-semibold ${value >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
      {value >= 0 ? '+' : ''}
      {formatCredits(value)}
    </span>
  );
}

function TransactionRow({ t, showEmail }: { t: AdminTransaction; showEmail: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm">
      <Amount value={t.amount} />
      <span className="font-medium">{REASON_LABELS[t.reason] ?? t.reason}</span>
      {showEmail && <span className="truncate text-white/70">{t.email ?? t.userId.slice(0, 8)}</span>}
      {t.note && <span className="truncate text-white/60">“{t.note}”</span>}
      <span className="label ml-auto text-white/50">
        balance {formatCredits(t.balanceAfter)} · {timeAgo(t.createdAt)}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------- Overview
function Overview() {
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .adminStats()
      .then(setStats)
      .catch((e) => setError(toApiError(e).message));
  }, []);
  if (error) return <p className="text-rose-200">{error}</p>;
  if (!stats) return <div className="skeleton h-48 rounded-3xl" />;
  const n = (v: number) => v.toLocaleString();
  return (
    <div className="space-y-8">
      <section>
        <h2 className="label mb-3 text-white/55">Revenue</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Received, last 30 days" value={formatPrice(stats.revenue.paid30dCents / 100)} hint={`${n(stats.revenue.orders30d)} paid orders`} />
          <Stat label="Received, all time" value={formatPrice(stats.revenue.paidAllCents / 100)} hint={`${n(stats.revenue.ordersAll)} paid orders`} />
          <Stat label="Credits held by users" value={formatCredits(stats.creditsOutstanding)} hint="Unspent balances" />
          <Stat label="Credits spent on AI, 30 days" value={formatCredits(stats.ai.creditsSpent30d)} />
        </div>
      </section>
      <section>
        <h2 className="label mb-3 text-white/55">Users</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Total users" value={n(stats.users.total)} />
          <Stat label="New, last 7 days" value={n(stats.users.new7d)} />
          <Stat label="New, last 30 days" value={n(stats.users.new30d)} />
        </div>
      </section>
      <section>
        <h2 className="label mb-3 text-white/55">AI usage</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="AI requests, 24 hours"
            value={n(stats.ai.requests24h)}
            hint={stats.ai.errors24h ? `${n(stats.ai.errors24h)} failed (no credits charged)` : 'No failures'}
          />
          <Stat label="AI requests, 30 days" value={n(stats.ai.requests30d)} />
          <Stat label="Web searches, 30 days" value={n(stats.ai.webSearches30d)} hint="Billed per search by Anthropic" />
          <Stat
            label="Tokens, 30 days"
            value={n(stats.ai.inputTokens30d + stats.ai.outputTokens30d)}
            hint={`${n(stats.ai.inputTokens30d)} in · ${n(stats.ai.outputTokens30d)} out`}
          />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Users
function UserDetail({ userId, onToast, onChanged }: { userId: string; onToast: (m: string) => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<AdminUserDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .adminUser({ userId })
      .then(setDetail)
      .catch((e) => setError(toApiError(e).message));
  }, [userId]);
  useEffect(() => {
    setDetail(null);
    load();
  }, [load]);

  async function adjust() {
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value === 0) {
      setFormError('Enter an amount, for example 10 or -1.5.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await api.adminAdjustCredits({ userId, amount: value, note });
      onToast(`${value > 0 ? 'Added' : 'Removed'} ${formatCredits(Math.abs(value))} credits. New balance: ${formatCredits(res.newBalance)}.`);
      setAmount('');
      setNote('');
      load();
      onChanged();
    } catch (e) {
      setFormError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function setTier(tier: Tier) {
    try {
      await api.adminSetTier({ userId, tier });
      onToast(`Tier changed to ${tier}.`);
      load();
      onChanged();
    } catch (e) {
      onToast(toApiError(e).message);
    }
  }

  if (error) return <Card className="text-rose-200">{error}</Card>;
  if (!detail) return <div className="skeleton h-80 rounded-3xl" />;
  const u = detail.user;
  return (
    <Card className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl font-semibold">{u.email ?? 'No email'}</p>
          <p className="label mt-1 text-white/55">
            Joined {timeAgo(u.createdAt)} · {detail.analysesCount} searches{detail.isAdmin ? ' · admin' : ''}
          </p>
        </div>
        <TierBadge tier={u.tier} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="label text-white/55">Balance</p>
          <p className="font-mono text-2xl font-semibold">{formatCredits(u.credits)}</p>
        </div>
        <div>
          <p className="label text-white/55">AI requests, 30 days</p>
          <p className="font-mono text-2xl font-semibold">{detail.usage.requests30d}</p>
          {detail.usage.errors30d > 0 && <p className="text-xs text-white/55">{detail.usage.errors30d} failed</p>}
        </div>
        <div>
          <p className="label text-white/55">Last AI request</p>
          <p className="text-sm">{detail.usage.lastRequestAt ? timeAgo(detail.usage.lastRequestAt) : 'Never'}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="font-semibold">Adjust credits</p>
        <p className="mt-1 text-xs text-white/55">Positive to add, negative to remove (steps of 0.5). Recorded in the user’s history with your note.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 10" className={`${input} w-28 font-mono`} aria-label="Amount" />
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Reason, e.g. Refund for a failed search" className={`${input} min-w-0 flex-1`} aria-label="Note" />
          <button onClick={adjust} disabled={busy} className="btn-primary h-11 rounded-full px-5 text-sm font-semibold">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        {formError && (
          <p className="mt-2 text-sm text-rose-200" role="alert">
            {formError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 font-semibold">Tier</p>
        {TIERS.map((t) => (
          <button
            key={t}
            onClick={() => t !== u.tier && void setTier(t)}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${t === u.tier ? 'btn-primary' : 'border border-white/15 text-white/75 hover:bg-white/10'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-2 font-semibold">Credit history</p>
        {detail.transactions.length === 0 ? (
          <p className="text-sm text-white/55">No credit movements yet.</p>
        ) : (
          <ul className="space-y-2">
            {detail.transactions.map((t) => (
              <TransactionRow key={t.id} t={t} showEmail={false} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-2 font-semibold">Orders</p>
        {detail.orders.length === 0 ? (
          <p className="text-sm text-white/55">No orders.</p>
        ) : (
          <ul className="space-y-2">
            {detail.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm">
                <span className="font-medium">{CREDIT_PACKS[o.pack]?.name ?? o.pack}</span>
                <span className="text-white/70">{formatPrice(o.amountCents / 100)}</span>
                <span className="label text-white/55">{o.receiptNumber ?? o.status}</span>
                <span className="label ml-auto text-white/50">{timeAgo(o.paidAt ?? o.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Users({ onToast }: { onToast: (m: string) => void }) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((q: string) => {
    api
      .adminUsers({ search: q })
      .then((r) => {
        setUsers(r.users);
        setError(null);
      })
      .catch((e) => setError(toApiError(e).message));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => load(search), 300);
    return () => window.clearTimeout(t);
  }, [search, load]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by email" className={`${input} w-full`} aria-label="Search users by email" />
        {error && <p className="mt-3 text-sm text-rose-200">{error}</p>}
        {!users ? (
          <div className="skeleton mt-4 h-60 rounded-3xl" />
        ) : users.length === 0 ? (
          <p className="mt-4 text-white/60">No users found.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {users.map((u) => (
              <li key={u.userId}>
                <button
                  onClick={() => setSelected(u.userId)}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                    selected === u.userId ? 'border-cyan-300/60 bg-cyan-300/[0.08]' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{u.email ?? u.userId}</span>
                    <span className="label text-white/50">joined {timeAgo(u.createdAt)}</span>
                  </span>
                  <span className="font-mono text-sm">{formatCredits(u.credits)}</span>
                  <span className="hidden sm:block">
                    <TierBadge tier={u.tier} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="label mt-3 text-white/45">Shows the 50 newest users, or the first 50 matches.</p>
      </div>
      <div>
        {selected ? (
          <UserDetail userId={selected} onToast={onToast} onChanged={() => load(search)} />
        ) : (
          <Card className="text-white/60">Choose a user to see their balance, history and orders, and to adjust credits or tier.</Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Payments
function Payments() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'paid' | 'processing' | 'failed'>('paid');
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    api
      .adminOrders()
      .then((r) => {
        setOrders(r.orders);
        setError(null);
      })
      .catch((e) => setError(toApiError(e).message));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 30000);
    return () => window.clearInterval(t);
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase();
    return (orders ?? [])
      .filter((o) =>
        filter === 'paid' ? o.status === 'paid' : filter === 'processing' ? o.status === 'processing' : o.status === 'failed' || o.status === 'cancelled',
      )
      .filter(
        (o) =>
          !q ||
          (o.receiptNumber ?? '').toUpperCase().includes(q) ||
          (o.paymentReference ?? '').toUpperCase().includes(q) ||
          (o.buyerEmail ?? '').toUpperCase().includes(q),
      );
  }, [orders, filter, query]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['paid', 'Paid'],
            ['processing', 'Bank debit pending'],
            ['failed', 'Failed or cancelled'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${filter === id ? 'btn-primary' : 'text-muted hover:bg-white/10 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search receipt, payment ID or email"
          className={`${input} ml-auto w-full sm:w-72`}
        />
      </div>
      {error && <p className="mt-4 text-rose-200">{error}</p>}
      {!orders ? (
        <div className="skeleton mt-6 h-40 rounded-3xl" />
      ) : visible.length === 0 ? (
        <p className="mt-6 text-muted">Nothing here yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {visible.map((o) => (
            <li key={o.id} className="glass rounded-3xl p-5">
              <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                <div className="min-w-0">
                  <p className="label text-white/55">{o.receiptNumber ? 'Receipt' : 'Payment'}</p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-lg font-semibold text-cyan-100">{o.receiptNumber ?? o.paymentReference?.slice(0, 18) ?? '—'}</span>
                    {o.paymentReference && <CopyButton text={o.paymentReference} label="Copy Stripe ID" />}
                  </div>
                  {o.methodLabel && <p className="label mt-1 text-white/55">{o.methodLabel}</p>}
                </div>
                <div>
                  <p className="label text-white/55">Pack</p>
                  <p className="font-medium">
                    {CREDIT_PACKS[o.pack]?.name ?? o.pack} · {o.credits} credits
                  </p>
                </div>
                <div>
                  <p className="label text-white/55">Amount</p>
                  <p className="font-display text-lg font-semibold">{formatPrice((o.amountReceivedCents ?? o.amountCents) / 100)}</p>
                </div>
                <div className="min-w-0">
                  <p className="label text-white/55">Buyer</p>
                  <p className="truncate">{o.buyerEmail ?? 'Unknown'}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="label text-white/55">{o.paidAt ? `Paid ${timeAgo(o.paidAt)}` : `Ordered ${timeAgo(o.createdAt)}`}</p>
                  {o.status === 'failed' && o.failureMessage && <p className="mt-1 text-xs text-rose-200">{o.failureMessage}</p>}
                  {o.status === 'paid' && (
                    <p className="mt-1 text-xs text-white/55">{o.gift ? (o.redeemed ? 'Gift code used' : 'Gift code not used yet') : 'Credits added to buyer'}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="label mt-4 text-white/45">Payouts to your bank account are handled by Stripe (Stripe Dashboard → Balances).</p>
    </div>
  );
}

// ---------------------------------------------------------------- Transactions
function Transactions() {
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<AdminTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    api
      .adminTransactions({ reason: reason || undefined })
      .then((r) => {
        setRows(r.transactions);
        setError(null);
      })
      .catch((e) => setError(toApiError(e).message));
  }, [reason]);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {[['', 'All'], ...Object.entries(REASON_LABELS)].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setReason(id)}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${reason === id ? 'btn-primary' : 'border border-white/15 text-white/75 hover:bg-white/10'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="mt-4 text-rose-200">{error}</p>}
      {!rows ? (
        <div className="skeleton mt-6 h-60 rounded-3xl" />
      ) : rows.length === 0 ? (
        <p className="mt-6 text-white/60">No transactions.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {rows.map((t) => (
            <TransactionRow key={t.id} t={t} showEmail />
          ))}
        </ul>
      )}
      <p className="label mt-4 text-white/45">The latest 200 credit movements across all users.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Page
export default function AdminPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [tab, setTab] = useState<Tab>('overview');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Admin · Review Miner';
    api
      .me()
      .then((r) => setState(r.isAdmin ? 'ready' : 'denied'))
      .catch(() => setState('error'));
  }, []);

  return (
    <div className="relative min-h-full">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-night/30 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
          <a href={HOME_HREF} className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="font-display text-lg font-semibold tracking-tight">
              Review<span className="accent text-xl"> Miner</span>
            </span>
          </a>
          <span className="label rounded-full bg-white/10 px-2.5 py-1 text-white/70">Admin</span>
          <a href={HOME_HREF} className="ml-auto rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-sm font-medium text-muted hover:text-ink">
            ← Back to app
          </a>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-24 pt-10">
        <h1 className="font-display text-4xl font-semibold tracking-[-0.04em]">
          Admin <span className="accent">dashboard</span>
        </h1>

        {state === 'denied' && (
          <p className="glass mt-8 rounded-3xl p-6">
            This page is only for the site owner. To get access, run this in the Supabase SQL Editor with your email:
            <code className="mt-3 block rounded-xl bg-black/30 p-3 font-mono text-sm">
              insert into public.app_admins (user_id) select id from auth.users where email = 'you@example.com';
            </code>
          </p>
        )}
        {state === 'error' && <p className="glass mt-8 rounded-3xl p-6">Couldn’t load the admin dashboard. Refresh the page to try again.</p>}
        {state === 'loading' && <div className="skeleton mt-8 h-40 rounded-3xl" />}

        {state === 'ready' && (
          <>
            <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Admin sections">
              {(
                [
                  ['overview', 'Overview'],
                  ['users', 'Users & credits'],
                  ['payments', 'Payments'],
                  ['transactions', 'Transactions'],
                  ['system', 'System check'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${tab === id ? 'btn-primary' : 'text-muted hover:bg-white/10 hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-8">
              {tab === 'overview' && <Overview />}
              {tab === 'users' && <Users onToast={setToast} />}
              {tab === 'payments' && <Payments />}
              {tab === 'transactions' && <Transactions />}
              {tab === 'system' && <SystemCheck />}
            </div>
          </>
        )}
      </main>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
