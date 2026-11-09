import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { FOCUS_OPTIONS, LINK_COST, MAX_LINKS, PROMPT_COST, formatCredits, type FocusKey } from '../../shared/types';
import { extractUrls, hostOf, isLink, timeAgo } from '../lib/format';

// ---- Minimal typing for the browser speech API (Chrome, Edge, Safari) ----
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface SpeechRecognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognizerCtor = new () => SpeechRecognizer;

function getRecognizer(): RecognizerCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const START_CHIPS = ['Is it worth the price?', 'What breaks first?', 'Is it good for beginners?'];
const THREAD_CHIPS = ['What do people hate most?', 'Is it worth the price?', 'Any safety worries?'];
const CHIP_TINTS = [
  'border-violet-300/30 bg-violet-400/10 hover:bg-violet-400/20',
  'border-sky-300/30 bg-sky-400/10 hover:bg-sky-400/20',
  'border-cyan-300/30 bg-cyan-400/10 hover:bg-cyan-400/20',
];

interface Props {
  mode: 'start' | 'thread';
  busy?: boolean;
  focuses: FocusKey[];
  onFocusesChange: (next: FocusKey[]) => void;
  onSend: (text: string) => boolean;
  hint?: string | null;
  autoFocus?: boolean;
  recent?: { title: string; createdAt: string; onOpen: () => void } | null;
}

interface LinkBox {
  id: number;
  value: string;
}
let boxSeq = 0;
const newBox = (value = ''): LinkBox => ({ id: ++boxSeq, value });

export default function Composer({ mode, busy = false, focuses, onFocusesChange, onSend, hint, autoFocus = true, recent }: Props) {
  const [text, setText] = useState('');
  const [boxes, setBoxes] = useState<LinkBox[]>(() => (mode === 'start' ? [newBox()] : []));
  const boxesRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRecognizer | null>(null);
  const [canListen] = useState(() => typeof window !== 'undefined' && getRecognizer() !== null);
  const textLinks = extractUrls(text).urls;
  const boxLinks = boxes.map((b) => b.value.trim()).filter(Boolean);
  const badBox = boxes.some((b) => b.value.trim() !== '' && !isLink(b.value));
  const allLinks = [...new Set([...boxLinks.filter(isLink), ...textLinks].map((u) => u.toLowerCase()))];
  const linkCount = allLinks.length;
  const hasLink = linkCount > 0;
  const cost = hasLink ? linkCount * LINK_COST : PROMPT_COST;
  const tooMany = linkCount > MAX_LINKS;

  function focusBox(index: number) {
    requestAnimationFrame(() => {
      const inputs = boxesRef.current?.querySelectorAll<HTMLInputElement>('input');
      inputs?.[Math.min(index, inputs.length - 1)]?.focus();
    });
  }

  function addBox() {
    if (boxes.length >= MAX_LINKS) return;
    setBoxes((b) => [...b, newBox()]);
    focusBox(boxes.length);
  }

  function updateBox(id: number, value: string) {
    setNote(null);
    setBoxes((b) => b.map((x) => (x.id === id ? { ...x, value } : x)));
  }

  function removeBox(id: number) {
    setBoxes((b) => {
      const next = b.filter((x) => x.id !== id);
      return next.length === 0 && mode === 'start' ? [newBox()] : next;
    });
  }

  // Pasting several links at once spreads them across boxes.
  function pasteIntoBox(id: number, e: ClipboardEvent<HTMLInputElement>) {
    const pasted = extractUrls(e.clipboardData.getData('text')).urls;
    if (pasted.length < 2) return;
    e.preventDefault();
    setBoxes((b) => {
      const i = b.findIndex((x) => x.id === id);
      const before = b.slice(0, i);
      const after = b.slice(i + 1).filter((x) => x.value.trim());
      const merged = [...before, ...pasted.map((u) => newBox(u)), ...after].slice(0, MAX_LINKS);
      if (before.length + pasted.length + after.length > MAX_LINKS) {
        setNote(`You can add up to ${MAX_LINKS} links at a time.`);
      }
      return merged;
    });
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!busy && autoFocus) ref.current?.focus();
  }, [busy, autoFocus]);

  useEffect(() => () => recRef.current?.stop(), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function submit() {
    if (busy || (!text.trim() && boxLinks.length === 0)) return;
    if (badBox) {
      setNote('One of the links doesn’t look right. Check it, or remove that box.');
      return;
    }
    if (tooMany) {
      setNote(`You can add up to ${MAX_LINKS} links at a time.`);
      return;
    }
    recRef.current?.stop();
    setNote(null);
    const message = [...boxLinks, text.trim()].filter(Boolean).join(' ');
    if (onSend(message)) {
      setText('');
      setBoxes(mode === 'start' ? [newBox()] : []);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function toggleTopic(key: FocusKey) {
    onFocusesChange(focuses.includes(key) ? focuses.filter((f) => f !== key) : [...focuses, key]);
  }

  function addChip(chip: string) {
    setText((t) => (t.trim() ? `${t.trim()} ${chip}` : chip));
    if (mode === 'start' && !hasLink) setNote('Now paste a product link in the box above.');
    ref.current?.focus();
  }

  function toggleMic() {
    setNote(null);
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getRecognizer();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      let said = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) said += e.results[i][0].transcript;
      }
      if (said.trim()) setText((t) => (t.trim() ? `${t.trim()} ${said.trim()}` : said.trim()));
    };
    rec.onerror = (e) => {
      setNote(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone access is blocked. Allow it in your browser settings to talk instead of type.'
          : e.error === 'no-speech'
            ? 'We didn’t hear anything. Tap the mic and try again.'
            : 'Voice input stopped. Please try again or type instead.',
      );
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setNote('Voice input isn’t available right now.');
    }
  }

  const placeholder =
    mode === 'start'
      ? 'Ask a question about the products (optional)…'
      : boxes.length > 0
        ? 'Ask a question about the new links (optional)…'
        : 'Ask a follow-up about these products…';
  const chips = mode === 'start' ? START_CHIPS : THREAD_CHIPS;
  const canSend = !busy && (text.trim().length > 0 || boxLinks.length > 0);
  const iconBtn =
    'relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white';

  return (
    <div className="relative">
      {/* Soft colour glow behind the panel */}
      <div aria-hidden="true" className="pointer-events-none absolute -inset-6 -z-0 opacity-70 blur-3xl">
        <div className="absolute left-[8%] top-[10%] h-2/3 w-1/3 rounded-full bg-violet-400/50" />
        <div className="absolute right-[6%] top-0 h-2/3 w-1/3 rounded-full bg-cyan-300/50" />
        <div className="absolute bottom-0 left-1/3 h-1/2 w-1/3 rounded-full bg-blue-500/40" />
      </div>

      <div className="relative rounded-[28px] border border-white/15 bg-[#151a4a]/70 p-3 text-white shadow-[0_30px_80px_-24px_rgba(5,8,40,0.8),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl sm:p-4">
        {mode === 'start' && (
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2 text-[13px]">
            <span className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-1.5 text-white/80">
              <span aria-hidden="true">💡</span> <span className="font-mono font-medium text-cyan-200">Tip</span> add up to {MAX_LINKS} links to compare products
            </span>
            {recent && (
              <button
                type="button"
                onClick={recent.onOpen}
                className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-1.5 text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
              >
                <span aria-hidden="true">✨</span> <span className="font-mono font-medium text-violet-200">Last chat</span>{' '}
                <span className="inline-block max-w-[12rem] truncate align-bottom">{recent.title}</span> {timeAgo(recent.createdAt)}
              </button>
            )}
          </div>
        )}

        {/* Link boxes */}
        {(boxes.length > 0 || mode === 'thread') && (
          <div className="mb-3" ref={boxesRef}>
            {boxes.length > 0 && (
              <div className="space-y-2">
                {boxes.map((box, i) => {
                  const bad = box.value.trim() !== '' && !isLink(box.value);
                  const good = box.value.trim() !== '' && !bad;
                  return (
                    <div
                      key={box.id}
                      className={`group/box flex animate-pop items-center gap-2 rounded-2xl border bg-white/[0.05] py-1 pl-3 pr-1.5 transition-all duration-300 focus-within:bg-white/[0.08] ${
                        bad
                          ? 'border-rose-300/60'
                          : good
                            ? 'border-cyan-300/40 shadow-[0_0_18px_-6px_rgba(103,232,249,0.6)]'
                            : 'border-white/15 focus-within:border-white/35'
                      }`}
                    >
                      <span className="font-mono text-[11px] text-cyan-200/90" aria-hidden="true">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-white/50" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                        <path d="M8.5 11.5a3.5 3.5 0 005 0l2.5-2.5a3.5 3.5 0 00-5-5l-1 1M11.5 8.5a3.5 3.5 0 00-5 0L4 11a3.5 3.5 0 005 5l1-1" strokeLinecap="round" />
                      </svg>
                      <label htmlFor={`link-${mode}-${box.id}`} className="sr-only">
                        Product link {i + 1}
                      </label>
                      <input
                        id={`link-${mode}-${box.id}`}
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        value={box.value}
                        onChange={(e) => updateBox(box.id, e.target.value)}
                        onPaste={(e) => pasteIntoBox(box.id, e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            ref.current?.focus();
                          }
                        }}
                        disabled={busy}
                        placeholder={i === 0 ? 'Paste a product link, like https://www.amazon.com/…' : 'Paste another product link'}
                        className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 focus:outline-none disabled:opacity-60"
                        aria-invalid={bad}
                      />
                      {good && <span className="label hidden max-w-[9rem] truncate text-cyan-200/80 sm:inline">{hostOf(box.value.trim())}</span>}
                      <span className="label hidden text-white/45 sm:inline">{formatCredits(LINK_COST)} cr</span>
                      <button
                        type="button"
                        onClick={() => removeBox(box.id)}
                        aria-label={`Remove link ${i + 1}`}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className={`flex flex-wrap items-center justify-between gap-2 ${boxes.length > 0 ? 'mt-2' : ''}`}>
              {boxes.length < MAX_LINKS ? (
                <button
                  type="button"
                  onClick={addBox}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-white/30 px-3.5 py-1.5 text-sm text-white/80 transition-all duration-300 hover:border-cyan-300/70 hover:bg-white/[0.06] hover:text-white active:scale-95 disabled:opacity-50"
                >
                  <span className="text-base leading-none text-cyan-200" aria-hidden="true">+</span>
                  {boxes.length === 0 ? 'Add product links' : 'Add another link'}
                </button>
              ) : (
                <span className="label text-white/50">Up to {MAX_LINKS} links at a time</span>
              )}
              {hasLink && (
                <span className="label rounded-full bg-white/[0.07] px-3 py-1 text-white/75">
                  {linkCount} {linkCount === 1 ? 'link' : 'links'} × {formatCredits(LINK_COST)} = {formatCredits(cost)} credits
                </span>
              )}
            </div>
            {mode === 'thread' && boxes.length > 0 && <p className="label mt-2 text-white/50">New links start a new chat.</p>}
          </div>
        )}

        {/* Glowing input bar */}
        <div
          data-busy={busy}
          className="ai-ring flex flex-wrap items-center gap-1.5 rounded-[22px] border border-white/35 bg-white/[0.07] p-1.5 shadow-[0_0_0_1px_rgba(170,185,255,0.18),0_0_26px_rgba(125,145,255,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] transition-shadow focus-within:border-white/60 focus-within:shadow-[0_0_0_1px_rgba(170,200,255,0.4),0_0_34px_rgba(110,170,255,0.55),inset_0_1px_0_rgba(255,255,255,0.1)] sm:flex-nowrap sm:gap-2 sm:p-2"
        >
          <span
            aria-hidden="true"
            className="hidden h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/15 to-white/[0.03] sm:grid"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6">
              <defs>
                <linearGradient id="spark" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#C4B5FD" />
                  <stop offset="1" stopColor="#67E8F9" />
                </linearGradient>
              </defs>
              <path d="M10 3.5l1.7 5.1 5.1 1.7-5.1 1.7L10 17.1l-1.7-5.1-5.1-1.7 5.1-1.7z" fill="url(#spark)" />
              <path d="M18 3l.8 2.2L21 6l-2.2.8L18 9l-.8-2.2L15 6l2.2-.8z" fill="url(#spark)" />
            </svg>
          </span>

          <label htmlFor={`composer-${mode}`} className="sr-only">
            Product link or question
          </label>
          <textarea
            id={`composer-${mode}`}
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={busy}
            className="thin-scroll min-h-[44px] min-w-0 flex-1 basis-full resize-none sm:basis-auto bg-transparent px-2 py-2.5 text-[16px] leading-snug text-white caret-cyan-300 placeholder:text-white/45 focus:outline-none disabled:opacity-60 sm:text-[17px]"
          />

          <div className="relative flex shrink-0 items-center self-center" ref={popRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={`Choose what to find out (${focuses.length} selected)`}
              title="What to find out"
              className={`${iconBtn} ${open ? 'bg-white/10 text-white' : ''}`}
            >
              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
              </svg>
              {focuses.length > 0 && (
                <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-cyan-300 px-1 text-[10px] font-bold text-[#121828]">
                  {focuses.length}
                </span>
              )}
            </button>

            {canListen && (
              <button
                type="button"
                onClick={toggleMic}
                aria-pressed={listening}
                aria-label={listening ? 'Stop listening' : 'Speak your question'}
                title={listening ? 'Stop listening' : 'Speak instead of typing'}
                className={`${iconBtn} ${listening ? 'bg-rose-500/20 text-rose-300' : ''}`}
              >
                {listening && <span className="absolute inset-0 rounded-full ring-2 ring-rose-400/70 motion-safe:animate-ping" aria-hidden="true" />}
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" strokeLinecap="round" />
                </svg>
              </button>
            )}

            {open && (
              <div
                className={`absolute right-0 z-30 w-72 rounded-2xl border border-white/10 bg-[#1A2136] p-2 text-white shadow-2xl animate-rise ${
                  mode === 'thread' ? 'bottom-full mb-3' : 'top-full mt-3'
                }`}
              >
                <p className="px-2 pb-1 pt-1 text-sm font-semibold">What do you want to find out?</p>
                {FOCUS_OPTIONS.map((opt) => {
                  const on = focuses.includes(opt.key);
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => toggleTopic(opt.key)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm text-white/85 hover:bg-white/[0.07]"
                    >
                      <span aria-hidden="true">{opt.emoji}</span>
                      <span className="flex-1">{opt.label}</span>
                      <span
                        aria-hidden="true"
                        className={`grid h-5 w-5 place-items-center rounded-md border text-xs ${
                          on ? 'border-cyan-300 bg-cyan-300 text-[#121828]' : 'border-white/25 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="group ml-auto flex h-11 shrink-0 items-center gap-2.5 self-center rounded-2xl active:scale-95 sm:ml-0 border border-sky-200/70 bg-gradient-to-b from-[#5B8CFF] to-[#6E4CF2] pl-4 pr-3 text-left text-white shadow-[0_0_22px_rgba(108,120,255,0.6)] transition-all hover:shadow-[0_0_32px_rgba(120,130,255,0.85)] disabled:border-white/15 disabled:from-white/10 disabled:to-white/5 disabled:text-white/50 disabled:shadow-none sm:h-12"
          >
            <span className="leading-tight">
              <span className="block font-display text-[15px] font-semibold tracking-tight">{busy ? 'Working' : 'Send'}</span>
              <span className="hidden font-mono text-[10.5px] text-white/75 sm:block">{formatCredits(cost)} credits</span>
            </span>
            {busy ? (
              <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 20 20" className="h-5 w-5 transition-transform duration-300 group-hover:-translate-y-0.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M10 16V4M5 9l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>

        {/* Suggestion chips */}
        <div className="mt-3 flex flex-wrap gap-2 sm:pl-14">
          {chips.map((chip, i) => (
            <button
              key={chip}
              type="button"
              onClick={() => addChip(chip)}
              disabled={busy}
              style={{ animationDelay: `${120 + i * 70}ms` }}
              className={`animate-pop rounded-full border px-3.5 py-1.5 text-[13px] text-white/85 transition-all duration-300 hover:-translate-y-0.5 hover:text-white active:scale-95 disabled:opacity-50 sm:text-sm ${CHIP_TINTS[i % CHIP_TINTS.length]}`}
            >
              {chip}
            </button>
          ))}
        </div>

        {(hint || note) && (
          <p className="mt-3 px-1 text-sm text-amber-200 sm:pl-14" role="alert">
            {hint || note}
          </p>
        )}
        {listening && (
          <p className="mt-3 px-1 text-sm text-rose-200 sm:pl-14" role="status">
            Listening… speak your question, then tap the mic to stop.
          </p>
        )}
      </div>
    </div>
  );
}
