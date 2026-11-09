import { useEffect, useState } from 'react';
import { CREDIT_PACKS, FOCUS_OPTIONS, formatCredits, formatPrice, type CreditTransaction, type RedeemResponse, type Tier, type VoucherOrder, type FocusKey, type UserSettings } from '../../shared/types';
import { supabase } from '../lib/supabase';
import { timeAgo } from '../lib/format';
import Modal from './Modal';
import VoucherRedeem from './VoucherRedeem';
import TierBadge from './TierBadge';
import CopyButton from './CopyButton';
import Receipt from './Receipt';
import { api } from '../lib/api';
import { PRIVACY_HREF, TERMS_HREF } from '../lib/siteInfo';

type Tab = 'general' | 'billing' | 'account';

const REASONS: Record<CreditTransaction['reason'], string> = {
  signup_bonus: 'Welcome credits',
  analysis: 'Product search',
  follow_up: 'Follow-up question',
  purchase: 'Credits bought',
  voucher: 'Voucher redeemed',
  refund: 'Refund',
};

interface Props {
  settings: UserSettings;
  onSave: (next: UserSettings) => Promise<void>;
  credits: number | null;
  tier: Tier;
  email: string | undefined;
  provider: string | undefined;
  userId: string;
  onBuy: () => void;
  onSignOut: () => void;
  onClearedChats: () => void;
  onRedeemed: (result: RedeemResponse) => void;
  onClose: () => void;
}

export default function SettingsModal(p: Props) {
  const [tab, setTab] = useState<Tab>('general');
  const [draft, setDraft] = useState<UserSettings>(p.settings);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [txns, setTxns] = useState<CreditTransaction[] | null>(null);
  const [txnError, setTxnError] = useState(false);
  const [orders, setOrders] = useState<VoucherOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState(false);
  const [receipt, setReceipt] = useState<VoucherOrder | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState('');

  const dirty =
    draft.detail !== p.settings.detail ||
    draft.default_focuses.length !== p.settings.default_focuses.length ||
    draft.default_focuses.some((f) => !p.settings.default_focuses.includes(f));

  useEffect(() => {
    if (tab !== 'billing' || txns !== null) return;
    (async () => {
      const { data, error } = await supabase
        .from('credit_transactions')
        .select('id, amount, balance_after, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) setTxnError(true);
      else setTxns((data ?? []) as CreditTransaction[]);
    })();
  }, [tab, txns]);

  useEffect(() => {
    if (tab !== 'billing' || orders !== null) return;
    api
      .myOrders()
      .then((r) => setOrders(r.orders))
      .catch(() => setOrdersError(true));
  }, [tab, orders]);

  function toggle(key: FocusKey) {
    setSaveState('idle');
    setDraft((d) => ({
      ...d,
      default_focuses: d.default_focuses.includes(key) ? d.default_focuses.filter((f) => f !== key) : [...d.default_focuses, key],
    }));
  }

  async function save() {
    setSaveState('saving');
    try {
      await p.onSave(draft);
      setSaveState('saved');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Couldn’t save your settings.');
      setSaveState('error');
    }
  }

  async function clearAll() {
    setClearing(true);
    setClearError('');
    const { error } = await supabase.from('analyses').delete().eq('user_id', p.userId);
    setClearing(false);
    if (error) {
      setClearError('Couldn’t delete your chats. Check your connection and try again.');
      return;
    }
    setConfirmClear(false);
    p.onClearedChats();
  }

  const tabs: [Tab, string][] = [
    ['general', 'General'],
    ['billing', 'Credits'],
    ['account', 'Account'],
  ];

  return (
    <Modal title="Settings" onClose={p.onClose} wide>
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="flex gap-1 sm:w-36 sm:flex-col" role="tablist">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-full px-4 py-2 text-left text-sm font-medium transition-colors ${
                tab === id ? 'bg-ink text-white' : 'text-muted hover:bg-white/10 hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1" role="tabpanel">
          {tab === 'general' && (
            <div className="space-y-7">
              <section>
                <h3 className="font-semibold">Topics selected by default</h3>
                <p className="mt-1 text-sm text-muted">These are ticked for you every time you start a new chat.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {FOCUS_OPTIONS.map((opt) => {
                    const on = draft.default_focuses.includes(opt.key);
                    return (
                      <button
                        key={opt.key}
                        aria-pressed={on}
                        onClick={() => toggle(opt.key)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          on ? 'border-ink btn-primary text-white' : 'border-line text-muted hover:border-line-strong hover:text-ink'
                        }`}
                      >
                        <span aria-hidden="true">{opt.emoji}</span> {opt.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className="font-semibold">Report length</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ['quick', 'Quick summary', 'The top points only. Faster to read.'],
                      ['detailed', 'Detailed report', 'More themes and a longer overview.'],
                    ] as const
                  ).map(([value, label, desc]) => (
                    <label
                      key={value}
                      className={`cursor-pointer rounded-2xl border p-4 transition-colors ${
                        draft.detail === value ? 'border-violet-300 bg-white/[0.08] shadow-[0_0_20px_-6px_rgba(167,139,250,0.8)]' : 'border-line hover:border-line-strong'
                      }`}
                    >
                      <input
                        type="radio"
                        name="detail"
                        value={value}
                        checked={draft.detail === value}
                        onChange={() => {
                          setSaveState('idle');
                          setDraft((d) => ({ ...d, detail: value }));
                        }}
                        className="sr-only"
                      />
                      <span className="block font-medium">{label}</span>
                      <span className="mt-0.5 block text-sm text-muted">{desc}</span>
                    </label>
                  ))}
                </div>
              </section>

              <div className="flex items-center gap-3">
                <button
                  onClick={save}
                  disabled={!dirty || saveState === 'saving'}
                  className="rounded-full btn-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:bg-line disabled:text-subtle"
                >
                  {saveState === 'saving' ? 'Saving…' : 'Save changes'}
                </button>
                {saveState === 'saved' && !dirty && <span className="text-sm text-praise">Changes saved</span>}
                {saveState === 'error' && <span className="text-sm text-gripe">{saveError}</span>}
              </div>
            </div>
          )}

          {tab === 'billing' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between rounded-2xl bg-gradient-to-br from-blue-500/25 to-violet-500/25 p-5 ring-1 ring-white/15">
                <div>
                  <p className="text-sm text-muted">Credits left</p>
                  <p className="font-mono text-4xl font-medium tracking-tight">{p.credits === null ? '…' : formatCredits(p.credits)}</p>
                  <div className="mt-2">
                    <TierBadge tier={p.tier} />
                  </div>
                </div>
                <button onClick={p.onBuy} className="rounded-full btn-primary px-5 py-2.5 text-sm font-semibold text-white">
                  See packs
                </button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <VoucherRedeem
                  variant="compact"
                  onRedeemed={(res) => {
                    setTxns(null);
                    setOrders(null);
                    p.onRedeemed(res);
                  }}
                />
              </div>

              <section>
                <h3 className="font-semibold">Your orders and codes</h3>
                {ordersError && <p className="mt-2 text-sm text-muted">Couldn’t load your orders right now.</p>}
                {!ordersError && orders === null && <div className="skeleton mt-3 h-14" />}
                {orders && orders.length === 0 && (
                  <p className="mt-2 text-sm text-muted">Packs you buy show up here, with your code once the payment arrives.</p>
                )}
                {orders && orders.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {orders.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                        <span className="font-medium">{CREDIT_PACKS[o.pack]?.name ?? o.pack}</span>
                        <span className="label text-white/60">
                          {o.credits} credits · {formatPrice(o.amountCents / 100)}
                          {o.methodLabel ? ` · ${o.methodLabel}` : ''}
                        </span>
                        <span
                          className={`label ml-auto rounded-full px-2 py-0.5 ${
                            o.status === 'paid'
                              ? 'bg-emerald-300/15 text-emerald-200'
                              : o.status === 'failed'
                                ? 'bg-rose-300/15 text-rose-200'
                                : 'bg-amber-300/15 text-amber-200'
                          }`}
                        >
                          {o.status === 'paid'
                            ? o.gift
                              ? o.redeemed
                                ? 'Code used'
                                : 'Code ready'
                              : 'Credits added'
                            : o.status === 'failed'
                              ? 'Payment failed'
                              : 'Being confirmed'}
                        </span>
                        {o.status === 'paid' && o.gift && o.code && !o.redeemed && <CopyButton text={o.code} label="Copy code" />}
                        {o.status === 'paid' && (
                          <button onClick={() => setReceipt(o)} className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium hover:bg-white/10">
                            Receipt
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="font-semibold">Recent activity</h3>
                {txnError && <p className="mt-2 text-sm text-muted">Couldn’t load your activity right now.</p>}
                {!txnError && txns === null && (
                  <div className="mt-3 space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="skeleton h-9" />
                    ))}
                  </div>
                )}
                {txns && txns.length === 0 && <p className="mt-2 text-sm text-muted">No activity yet.</p>}
                {txns && txns.length > 0 && (
                  <ul className="mt-2 divide-y divide-line">
                    {txns.map((t) => (
                      <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                        <span>
                          {REASONS[t.reason] ?? t.reason}
                          <span className="label ml-2 text-subtle">{timeAgo(t.created_at)}</span>
                        </span>
                        <span className={`font-mono font-medium tabular-nums ${Number(t.amount) > 0 ? 'text-praise' : 'text-muted'}`}>
                          {Number(t.amount) > 0 ? `+${formatCredits(Number(t.amount))}` : `−${formatCredits(Math.abs(Number(t.amount)))}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {tab === 'account' && (
            <div className="space-y-6">
              <dl className="divide-y divide-line rounded-2xl border border-line">
                <div className="flex justify-between gap-4 px-4 py-3 text-sm">
                  <dt className="text-muted">Email</dt>
                  <dd className="truncate font-medium">{p.email}</dd>
                </div>
                <div className="flex justify-between gap-4 px-4 py-3 text-sm">
                  <dt className="text-muted">Signed in with</dt>
                  <dd className="font-medium">{p.provider === 'google' ? 'Google' : 'Email link'}</dd>
                </div>
              </dl>

              <p className="text-sm text-muted">
                Read our{' '}
                <a href={TERMS_HREF} className="font-medium text-cyan-200 underline underline-offset-2">
                  Terms and Conditions
                </a>{' '}
                and{' '}
                <a href={PRIVACY_HREF} className="font-medium text-cyan-200 underline underline-offset-2">
                  Privacy Policy
                </a>
                .
              </p>

              <button onClick={p.onSignOut} className="rounded-full border border-line-strong px-5 py-2.5 text-sm font-semibold hover:bg-white/10">
                Sign out
              </button>

              <section className="rounded-2xl border border-gripe/25 p-4">
                <h3 className="font-semibold">Delete all chats</h3>
                <p className="mt-1 text-sm text-muted">Removes every chat and report from your account. Your credits stay the same.</p>
                {confirmClear ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">This can’t be undone.</span>
                    <button
                      onClick={clearAll}
                      disabled={clearing}
                      className="rounded-full bg-gripe px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {clearing ? 'Deleting…' : 'Delete everything'}
                    </button>
                    <button onClick={() => setConfirmClear(false)} className="rounded-full px-4 py-2 text-sm font-semibold text-muted hover:text-ink">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="mt-3 rounded-full border border-gripe/40 px-4 py-2 text-sm font-semibold text-gripe hover:bg-gripe/5"
                  >
                    Delete all chats
                  </button>
                )}
                {clearError && <p className="mt-2 text-sm text-gripe">{clearError}</p>}
              </section>
            </div>
          )}
        </div>
      </div>
      {receipt && (
        <Modal title="Receipt" onClose={() => setReceipt(null)}>
          <Receipt order={receipt} />
          <div className="mt-5 flex justify-center gap-2 print:hidden">
            <button onClick={() => window.print()} className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-semibold hover:bg-white/10">
              Save as PDF / print
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
