import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CREDIT_PACKS, DEFAULT_FOCUSES, type PackId, type RedeemResponse, FOLLOW_UP_COST, LINK_COST, MAX_LINKS, formatCredits, type Analysis, type AnalysisSummary, type FocusKey, type FollowUp } from '../../shared/types';
import { useAuth } from '../hooks/useAuth';
import { useSettings } from '../hooks/useSettings';
import { api, toApiError } from '../lib/api';
import { extractUrls, hostOf } from '../lib/format';
import { takePendingPack, takePendingPrompt } from '../lib/pending';
import { sampleAnalysis } from '../lib/sample';
import { takePendingVoucher } from '../lib/voucher';
import { supabase } from '../lib/supabase';
import Composer from './Composer';
import CreditPill from './CreditPill';
import TierBadge from './TierBadge';
import Logo from './Logo';
import PricingPage from './PricingPage';
import CheckoutPage from './CheckoutPage';
import CheckoutCancelled from './CheckoutCancelled';
import ResultCard from './ResultCard';
import SettingsModal from './SettingsModal';
import Sidebar from './Sidebar';
import Toast from './Toast';
import { AnswerMessage, AssistantRow, ErrorMessage, ThinkingMessage, UserMessage } from './ThreadItems';

type ThreadItem =
  | { id: string; kind: 'ask'; urls?: string[]; question?: string; focuses?: FocusKey[] }
  | { id: string; kind: 'report'; analysis: Analysis }
  | { id: string; kind: 'answer'; followUp: FollowUp }
  | { id: string; kind: 'pending'; mode: 'mine' | 'ask' | 'load'; url?: string }
  | { id: string; kind: 'error'; message: string; code: string; retry?: () => void };

/** One chat in the sidebar: a single link, or several links sent together. */
export interface ChatSummary {
  key: string;
  /** The built-in example chat (the kettle): free to open, no credits, hideable. */
  example?: boolean;
  groupId: string | null;
  title: string;
  url: string;
  count: number;
  created_at: string;
}

let seq = 0;
const uid = () => `item-${Date.now()}-${seq++}`;

function newGroupId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function toChats(history: AnalysisSummary[]): ChatSummary[] {
  const chats = new Map<string, ChatSummary>();
  for (const h of history) {
    const key = h.group_id ?? h.id;
    const existing = chats.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    chats.set(key, {
      key,
      groupId: h.group_id,
      title: h.product_name || hostOf(h.url),
      url: h.url,
      count: 1,
      created_at: h.created_at,
    });
  }
  return [...chats.values()];
}

export default function Workspace() {
  const { session, credits, setCredits, tier, setTier, refreshCredits, signOut } = useAuth();
  const userId = session?.user.id;
  const { settings, loaded: settingsLoaded, save: saveSettings } = useSettings(userId);
  const [history, setHistory] = useState<AnalysisSummary[]>([]);
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [group, setGroup] = useState<Analysis[]>([]); // the products in the open chat
  const [chatKey, setChatKey] = useState<string | null>(null);
  const [inflight, setInflight] = useState(0);
  const busy = inflight > 0;
  const [focuses, setFocuses] = useState<FocusKey[]>(DEFAULT_FOCUSES);
  const [showBuy, setShowBuy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewToken = useRef(0);
  const pendingHandled = useRef(false);
  const [voucher, setVoucher] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [resumeOrder, setResumeOrder] = useState<string | null>(null);
  const [cancelledOrder, setCancelledOrder] = useState<string | null>(null);

  // Back from Stripe Checkout: /checkout/success?order=… or /checkout/cancelled?order=…
  useEffect(() => {
    const url = new URL(window.location.href);
    const path = url.pathname.replace(/\/+$/, '');
    const order = url.searchParams.get('order');
    const valid = !!order && /^[0-9a-f-]{36}$/i.test(order);
    if (path === '/checkout/success' || path === '/checkout/cancelled') {
      window.history.replaceState(window.history.state, '', '/');
      if (!valid) return;
      if (path === '/checkout/success') setResumeOrder(order);
      else setCancelledOrder(order);
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then((r) => setIsAdmin(r.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);

  // Let buyers know when a bank transfer has been confirmed and their code is ready.
  useEffect(() => {
    const KEY = 'review-miner:seen-paid-orders';
    const check = async () => {
      try {
        const { orders } = await api.myOrders();
        let seen: string[] = [];
        try {
          seen = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
        } catch {
          /* ignore */
        }
        const weekAgo = Date.now() - 7 * 864e5;
        const fresh = orders.filter(
          (o) => o.status === 'paid' && o.code && !seen.includes(o.id) && o.paidAt && new Date(o.paidAt).getTime() > weekAgo,
        );
        if (fresh.length) {
          void refreshCredits();
          const one = fresh[0];
          setToast(
            fresh.length > 1
              ? `${fresh.length} payments were confirmed. Your receipts are in Settings → Credits.`
              : one.gift
                ? `Your payment was confirmed. Your ${CREDIT_PACKS[one.pack]?.name ?? ''} voucher code is ready in Settings → Credits.`
                : `Your payment was confirmed and ${one.credits} credits were added to your account.`,
          );
          try {
            localStorage.setItem(KEY, JSON.stringify([...seen, ...fresh.map((o) => o.id)].slice(-100)));
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* not important */
      }
    };
    void check();
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // A voucher link (?code=RM-…) was opened: show the credits page, pre-filled, and redeem it.
  useEffect(() => {
    const code = takePendingVoucher();
    if (code) {
      setVoucher(code);
      setShowBuy(true);
    }
  }, []);

  const handleRedeemed = useCallback(
    (res: RedeemResponse) => {
      setCredits(res.newCredits);
      setTier(res.newTier);
      setVoucher(null);
      setToast(
        res.tierUpgraded
          ? `${res.creditsAdded.toLocaleString()} credits added. Welcome to ${res.newTier}! ♛`
          : `${res.creditsAdded.toLocaleString()} credits added successfully!`,
      );
    },
    [setCredits, setTier],
  );
  const EXAMPLE_KEY = 'review-miner:hide-example-chat';
  const [showExample, setShowExample] = useState(() => {
    try {
      return localStorage.getItem(EXAMPLE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const exampleChat: ChatSummary = {
    key: 'example',
    example: true,
    groupId: null,
    title: `Example: ${sampleAnalysis.report.product_name}`,
    url: sampleAnalysis.url,
    count: 1,
    created_at: new Date().toISOString(),
  };
  const chats = useMemo(() => {
    const real = toChats(history);
    return showExample ? [...real, exampleChat] : real;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, showExample]);
  const [autoBuy, setAutoBuy] = useState<PackId | null>(null);

  // A tier picked on the home page before signing up: open Stripe for it now.
  useEffect(() => {
    const pack = takePendingPack();
    if (pack) {
      setAutoBuy(pack);
      setShowBuy(true);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryState('loading');
    const { data, error } = await supabase
      .from('analyses')
      .select('id, group_id, url, product_name, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      setHistoryState('error');
      return;
    }
    setHistory((data ?? []) as AnalysisSummary[]);
    setHistoryState('ready');
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Apply the saved default topics once settings arrive.
  useEffect(() => {
    if (settingsLoaded && items.length === 0) setFocuses(settings.default_focuses);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, settings.default_focuses]);

  // Shareable buy link: yoursite.com/#buy opens the credit packs.
  useEffect(() => {
    const open = () => {
      let wanted = window.location.hash === '#buy';
      try {
        if (sessionStorage.getItem('review-miner:open-pricing')) {
          sessionStorage.removeItem('review-miner:open-pricing');
          wanted = true;
        }
      } catch {
        /* storage unavailable */
      }
      if (wanted) {
        setShowBuy(true);
        if (window.location.hash === '#buy') window.history.replaceState({}, '', window.location.pathname + window.location.search);
      }
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);


  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [items]);

  const replaceItem = (id: string, next: ThreadItem) =>
    setItems((prev) => prev.map((item) => (item.id === id ? next : item)));

  const failItem = (pendingId: string, err: unknown, retry: () => void) => {
    const e = toApiError(err);
    if (e.code === 'NO_CREDITS') {
      setShowBuy(true);
      void refreshCredits();
    }
    const next: ThreadItem = {
      id: pendingId,
      kind: 'error',
      code: e.code,
      message: e.message,
      retry: e.code === 'NO_CREDITS' || e.code === 'AI_NOT_CONNECTED' || e.status === 400 ? undefined : retry,
    };
    setItems((prev) => {
      // When several links fail for the same account-wide reason, say it once.
      const shared = e.code === 'AI_NOT_CONNECTED' || e.code === 'NO_CREDITS';
      if (shared && prev.some((it) => it.kind === 'error' && it.code === e.code && it.id !== pendingId)) {
        return prev.filter((it) => it.id !== pendingId);
      }
      return prev.map((it) => (it.id === pendingId ? next : it));
    });
  };

  async function runMine(pendingId: string, url: string, question: string, chosen: FocusKey[], groupId: string | null) {
    const token = viewToken.current;
    setInflight((n) => n + 1);
    try {
      const res = await api.mine({ url, focuses: chosen, question: question || null, detail: settings.detail, groupId });
      setCredits(res.credits);
      const a = res.analysis;
      setHistory((prev) => [
        { id: a.id, group_id: a.group_id ?? groupId, url: a.url, product_name: a.product_name, created_at: a.created_at },
        ...prev.filter((h) => h.id !== a.id),
      ]);
      if (token !== viewToken.current) return;
      replaceItem(pendingId, { id: pendingId, kind: 'report', analysis: a });
      setGroup((g) => [...g.filter((x) => x.id !== a.id), a]);
      setChatKey((k) => k ?? groupId ?? a.id);
    } catch (err) {
      if (token !== viewToken.current) return;
      failItem(pendingId, err, () => {
        replaceItem(pendingId, { id: pendingId, kind: 'pending', mode: 'mine', url });
        void runMine(pendingId, url, question, chosen, groupId);
      });
    } finally {
      setInflight((n) => Math.max(0, n - 1));
    }
  }

  async function runAsk(pendingId: string, analysisIds: string[], question: string) {
    const token = viewToken.current;
    setInflight((n) => n + 1);
    try {
      const res = await api.ask({ analysisIds, question });
      setCredits(res.credits);
      if (token !== viewToken.current) return;
      replaceItem(pendingId, { id: pendingId, kind: 'answer', followUp: res.followUp });
    } catch (err) {
      if (token !== viewToken.current) return;
      failItem(pendingId, err, () => {
        replaceItem(pendingId, { id: pendingId, kind: 'pending', mode: 'ask' });
        void runAsk(pendingId, analysisIds, question);
      });
    } finally {
      setInflight((n) => Math.max(0, n - 1));
    }
  }

  function send(text: string, chosen: FocusKey[] = focuses): boolean {
    setHint(null);
    const trimmed = text.trim();
    if (!trimmed || busy) return false;
    const { urls, rest } = extractUrls(trimmed);

    if (urls.length > MAX_LINKS) {
      setHint(`You can add up to ${MAX_LINKS} links at a time.`);
      return false;
    }

    const cost = urls.length > 0 ? urls.length * LINK_COST : FOLLOW_UP_COST;
    if (credits !== null && credits < cost) {
      setHint(
        urls.length > 1
          ? `${urls.length} links need ${formatCredits(cost)} credits and you have ${formatCredits(credits)}. Remove a link or add credits.`
          : `This needs ${formatCredits(cost)} credits and you have ${formatCredits(credits)}.`,
      );
      setShowBuy(true);
      return false;
    }

    if (urls.length > 0) {
      if (chosen.length === 0 && !rest) {
        setHint('Choose at least one topic, or type a question.');
        return false;
      }
      viewToken.current += 1;
      const groupId = urls.length > 1 ? newGroupId() : null;
      const pending = urls.map((url) => ({ id: uid(), url }));
      setGroup([]);
      setChatKey(groupId);
      setItems([
        { id: uid(), kind: 'ask', urls, question: rest || undefined, focuses: chosen },
        ...pending.map((p) => ({ id: p.id, kind: 'pending' as const, mode: 'mine' as const, url: p.url })),
      ]);
      pending.forEach((p) => void runMine(p.id, p.url, rest, chosen, groupId));
      return true;
    }

    if (chatKey === 'example') {
      setHint('This is an example chat. Paste a product link in the box to start your own.');
      return false;
    }

    if (group.length > 0) {
      const pendingId = uid();
      setItems((prev) => [...prev, { id: uid(), kind: 'ask', question: trimmed }, { id: pendingId, kind: 'pending', mode: 'ask' }]);
      void runAsk(
        pendingId,
        group.map((a) => a.id),
        trimmed,
      );
      return true;
    }

    setHint('Start by pasting a product link in the box above.');
    return false;
  }

  // Run links the visitor typed on the home page before signing in.
  useEffect(() => {
    if (pendingHandled.current) return;
    pendingHandled.current = true;
    const pending = takePendingPrompt();
    if (!pending) return;
    const chosen = pending.focuses.length ? pending.focuses : DEFAULT_FOCUSES;
    setFocuses(chosen);
    send(pending.text, chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openChat(chat: ChatSummary) {
    setDrawerOpen(false);
    setHint(null);
    viewToken.current += 1;
    if (chat.example) {
      setGroup([]);
      setChatKey(chat.key);
      setItems([
        { id: uid(), kind: 'ask', urls: [sampleAnalysis.url], question: sampleAnalysis.question ?? undefined, focuses: sampleAnalysis.focuses },
        { id: uid(), kind: 'report', analysis: sampleAnalysis },
      ]);
      return;
    }
    const token = viewToken.current;
    const loadingId = uid();
    setGroup([]);
    setChatKey(chat.key);
    setItems([{ id: loadingId, kind: 'pending', mode: 'load' }]);

    const base = supabase.from('analyses').select('id, group_id, url, product_name, focuses, question, report, created_at');
    const a = await (chat.groupId ? base.eq('group_id', chat.groupId) : base.eq('id', chat.key)).order('created_at', {
      ascending: true,
    });
    if (token !== viewToken.current) return;

    const analyses = (a.data ?? []) as Analysis[];
    if (a.error || analyses.length === 0) {
      setItems([
        {
          id: loadingId,
          kind: 'error',
          code: 'LOAD_FAILED',
          message: 'Couldn’t open this chat. Check your connection and try again.',
          retry: () => void openChat(chat),
        },
      ]);
      return;
    }

    const m = await supabase
      .from('analysis_messages')
      .select('id, analysis_id, question, answer, created_at')
      .in(
        'analysis_id',
        analyses.map((x) => x.id),
      )
      .order('created_at', { ascending: true });
    if (token !== viewToken.current) return;

    const first = analyses[0];
    const next: ThreadItem[] = [
      { id: uid(), kind: 'ask', urls: analyses.map((x) => x.url), question: first.question ?? undefined, focuses: first.focuses },
      ...analyses.map((analysis) => ({ id: uid(), kind: 'report' as const, analysis })),
    ];
    for (const f of (m.data ?? []) as FollowUp[]) {
      next.push({ id: uid(), kind: 'ask', question: f.question }, { id: uid(), kind: 'answer', followUp: f });
    }
    setItems(next);
    setGroup(analyses);
  }

  function closeChat() {
    viewToken.current += 1;
    setDrawerOpen(false);
    setItems([]);
    setGroup([]);
    setChatKey(null);
    setInflight(0);
    setHint(null);
    setFocuses(settings.default_focuses);
  }

  async function removeChat(chat: ChatSummary) {
    if (chat.example) {
      try {
        localStorage.setItem(EXAMPLE_KEY, '1');
      } catch {
        /* storage unavailable */
      }
      setShowExample(false);
      if (chatKey === chat.key) closeChat();
      setToast('Example chat hidden');
      return;
    }
    const query = supabase.from('analyses').delete();
    const { error } = await (chat.groupId ? query.eq('group_id', chat.groupId) : query.eq('id', chat.key));
    if (error) {
      setToast('Couldn’t remove that chat. Please try again.');
      return;
    }
    setHistory((prev) => prev.filter((h) => (h.group_id ?? h.id) !== chat.key));
    if (chatKey === chat.key) closeChat();
    setToast('Chat closed and removed');
  }

  const closeToast = useCallback(() => setToast(null), []);
  const openBuy = () => {
    setDrawerOpen(false);
    setShowSettings(false);
    setShowBuy(true);
  };

  const sidebar = (onCollapse?: () => void) => (
    <Sidebar
      chats={chats}
      historyState={historyState}
      activeKey={chatKey}
      credits={credits}
      tier={tier}
      email={session?.user.email}
      onNew={closeChat}
      onOpen={(chat) => void openChat(chat)}
      onRemove={removeChat}
      onBuy={openBuy}
      onSettings={() => {
        setDrawerOpen(false);
        setShowSettings(true);
      }}
      onRetryHistory={() => void loadHistory()}
      onCollapse={onCollapse}
      isAdmin={isAdmin}
    />
  );

  const chatTitle =
    chatKey === 'example'
      ? `Example: ${sampleAnalysis.report.product_name}`
      : group.length > 1
      ? `${group[0].report.product_name} + ${group.length - 1} more`
      : group[0]?.report.product_name ?? (items.length ? 'New chat' : '');

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <aside className="hidden w-72 shrink-0 md:block">{sidebar()}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-night/60 backdrop-blur-sm animate-fade" onClick={() => setDrawerOpen(false)} />
          <div className="glass-strong absolute inset-y-0 left-0 w-[85%] max-w-xs animate-slide-in">{sidebar(() => setDrawerOpen(false))}</div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-white/[0.03] px-3 backdrop-blur-xl sm:px-5">
          <button onClick={() => setDrawerOpen(true)} className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-ink md:hidden" aria-label="Open menu">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          {chatTitle ? (
            <h1 className="min-w-0 flex-1 truncate font-display text-[15px] font-medium tracking-tight">{chatTitle}</h1>
          ) : (
            <span className="flex flex-1 items-center gap-2 font-display font-semibold md:hidden">
              <Logo className="h-6 w-6" /> Review Miner
            </span>
          )}
          {!chatTitle && <span className="hidden flex-1 md:block" />}
          <div className="flex items-center gap-2 md:hidden">
            <CreditPill credits={credits} onClick={openBuy} />
          </div>
          <div className="hidden md:block">
            <TierBadge tier={tier} />
          </div>
          {items.length > 0 && (
            <button
              onClick={closeChat}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-muted backdrop-blur transition-colors hover:border-white/40 hover:text-ink"
              title="Close this chat (it stays in your list)"
            >
              <span aria-hidden="true">✕</span>
              <span className="hidden sm:inline">Close chat</span>
              <span className="sr-only sm:hidden">Close chat</span>
            </button>
          )}
        </header>

        {items.length === 0 ? (
          <div
            className="thin-scroll relative flex flex-1 flex-col overflow-y-auto"
          >
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
              {[
                'left-[12%] top-[14%] h-24 w-24',
                'right-[10%] top-[22%] h-32 w-32',
                'left-[30%] top-[8%] h-10 w-10',
                'right-[30%] bottom-[18%] h-16 w-16',
                'left-[8%] bottom-[12%] h-20 w-20',
              ].map((c) => (
                <span key={c} className={`absolute rounded-full bg-white/10 blur-2xl motion-safe:animate-drift ${c}`} />
              ))}
            </div>
            <div className="relative m-auto w-full max-w-3xl px-4 py-12">
              <div className="text-center">
                <h2 className="font-display text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                  <span className="word mr-[0.25em]">What</span>
                  <span className="word mr-[0.25em]" style={{ animationDelay: '70ms' }}>are</span>
                  <span className="word mr-[0.25em]" style={{ animationDelay: '140ms' }}>buyers</span>
                  <span className="word accent" style={{ animationDelay: '230ms' }}>saying?</span>
                </h2>
                <p className="mx-auto mt-3 max-w-md text-ink-soft animate-page-in [animation-delay:300ms]">Paste a product link and get the honest summary in plain English.</p>
              </div>
              <div className="mt-10 animate-page-in [animation-delay:420ms]">
                <Composer
                  mode="start"
                  busy={busy}
                  focuses={focuses}
                  onFocusesChange={setFocuses}
                  onSend={(t) => send(t)}
                  hint={hint}
                  recent={(() => {
                    const last = chats.find((c) => !c.example);
                    return last
                      ? {
                          title: last.count > 1 ? `${last.title} + ${last.count - 1} more` : last.title,
                          createdAt: last.created_at,
                          onOpen: () => void openChat(last),
                        }
                      : null;
                  })()}
                />
              </div>
              {credits !== null && credits < LINK_COST && (
                <p className="mt-8 text-center text-sm text-white">
                  You need {formatCredits(LINK_COST)} credits for each prompt.{' '}
                  <button onClick={openBuy} className="font-semibold underline underline-offset-2">
                    See credit packs
                  </button>
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="thin-scroll flex-1 overflow-y-auto overscroll-contain scroll-smooth">
              <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:py-8">
                {items.map((item) => {
                  switch (item.kind) {
                    case 'ask':
                      return <UserMessage key={item.id} urls={item.urls} question={item.question} focuses={item.focuses} />;
                    case 'report':
                      return (
                        <AssistantRow key={item.id}>
                          <p className="mb-3 leading-relaxed">
                            Here’s what buyers say about <span className="font-semibold">{item.analysis.product_name ?? hostOf(item.analysis.url)}</span>:
                          </p>
                          <ResultCard analysis={item.analysis} />
                        </AssistantRow>
                      );
                    case 'answer':
                      return (
                        <AssistantRow key={item.id}>
                          <AnswerMessage followUp={item.followUp} />
                        </AssistantRow>
                      );
                    case 'pending':
                      return (
                        <AssistantRow key={item.id}>
                          <ThinkingMessage mode={item.mode} url={item.url} />
                        </AssistantRow>
                      );
                    case 'error':
                      return (
                        <AssistantRow key={item.id}>
                          <ErrorMessage
                            message={item.message}
                            onRetry={item.retry}
                            onBuy={item.code === 'NO_CREDITS' ? openBuy : undefined}
                          />
                        </AssistantRow>
                      );
                  }
                })}
              </div>
            </div>
            <div className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
              <div className="mx-auto max-w-3xl">
                <Composer mode="thread" busy={busy} focuses={focuses} onFocusesChange={setFocuses} onSend={(t) => send(t)} hint={hint} />
              </div>
            </div>
          </>
        )}
      </main>

      {showSettings && userId && (
        <SettingsModal
          settings={settings}
          onSave={async (next) => {
            await saveSettings(next);
            if (items.length === 0) setFocuses(next.default_focuses);
          }}
          credits={credits}
          tier={tier}
          email={session?.user.email}
          provider={session?.user.app_metadata?.provider as string | undefined}
          userId={userId}
          onBuy={openBuy}
          onSignOut={() => void signOut()}
          onClearedChats={() => {
            setHistory([]);
            closeChat();
            setShowSettings(false);
            setToast('All chats deleted');
          }}
          onRedeemed={handleRedeemed}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showBuy && (
        <PricingPage
          credits={credits}
          autoBuy={autoBuy}
          voucher={voucher}
          onRedeemed={handleRedeemed}
          onClose={() => {
            setShowBuy(false);
            setVoucher(null);
            setAutoBuy(null);
          }}
        />
      )}
      {cancelledOrder && (
        <CheckoutCancelled
          orderId={cancelledOrder}
          onPaidInstead={() => {
            setResumeOrder(cancelledOrder);
            setCancelledOrder(null);
          }}
          onChoosePack={() => {
            setCancelledOrder(null);
            setShowBuy(true);
          }}
          onClose={() => setCancelledOrder(null)}
        />
      )}
      {resumeOrder && (
        <CheckoutPage
          resumeOrderId={resumeOrder}
          onCredits={(n) => setCredits(n)}
          onClose={() => {
            setResumeOrder(null);
            void refreshCredits();
          }}
        />
      )}
      <Toast message={toast} onClose={closeToast} />
    </div>
  );
}
