import { useEffect, useState, type ReactNode } from 'react';
import type { FocusKey, FollowUp } from '../../shared/types';
import { focusLabel, hostOf } from '../lib/format';
import CopyButton from './CopyButton';
import Logo from './Logo';

export function UserMessage({ urls, question, focuses }: { urls?: string[]; question?: string; focuses?: FocusKey[] }) {
  return (
    <div className="flex justify-end animate-rise">
      <div className="max-w-[80%] rounded-3xl rounded-br-lg border border-white/15 bg-gradient-to-br from-blue-500/35 to-violet-500/35 px-4 py-2.5 shadow-[0_8px_30px_-12px_rgba(110,90,255,0.6)] backdrop-blur-md">
        {urls && urls.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {urls.map((url, i) => (
              <a
                key={url}
                href={/^https?:\/\//i.test(url) ? url : `https://${url}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-white/10 px-2.5 py-1 text-sm font-medium ring-1 ring-white/20 hover:ring-white/40"
              >
                {urls.length > 1 && <span className="font-mono text-[10px] text-cyan-200">{String(i + 1).padStart(2, '0')}</span>}
                <span aria-hidden="true">🔗</span>
                <span className="truncate">{hostOf(url)}</span>
              </a>
            ))}
          </div>
        )}
        {question && <p className={`whitespace-pre-wrap leading-relaxed ${urls?.length ? 'mt-2' : ''}`}>{question}</p>}
        {focuses && focuses.length > 0 && (
          <p className="mt-2 text-xs text-white/70">{focuses.map((f) => focusLabel(f)).join(', ')}</p>
        )}
      </div>
    </div>
  );
}

export function AssistantRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 animate-rise">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 shadow-[0_0_16px_rgba(120,130,255,0.4)] backdrop-blur">
        <Logo className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function AnswerMessage({ followUp }: { followUp: FollowUp }) {
  const { answer, points } = followUp.answer;
  const copy = [answer, ...points.map((p) => `- ${p}`)].join('\n');
  return (
    <div>
      <p className="leading-relaxed">{answer}</p>
      {points.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {points.map((p, i) => (
            <li key={i} className="flex gap-2.5 text-muted">
              <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <CopyButton text={copy} />
      </div>
    </div>
  );
}

const MINE_STEPS = ['Opening the product page', 'Reading the reviews', 'Spotting patterns', 'Writing your summary'];
const ASK_STEPS = ['Looking through the reviews', 'Writing an answer'];

export function ThinkingMessage({ mode, url }: { mode: 'mine' | 'ask' | 'load'; url?: string }) {
  const steps = mode === 'mine' ? MINE_STEPS : mode === 'ask' ? ASK_STEPS : ['Opening your chat'];
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), mode === 'mine' ? 7000 : 4000);
    return () => window.clearInterval(t);
  }, [mode, steps.length]);

  return (
    <div aria-busy="true">
      <p className="flex items-center gap-2 font-mono text-[13px] font-medium" role="status" aria-live="polite">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full bg-gold motion-safe:animate-pulse" style={{ animationDelay: `${i * 180}ms` }} />
          ))}
        </span>
        {steps[step]}…
        {url && <span className="label truncate text-cyan-200/80">{hostOf(url)}</span>}
      </p>
      {mode === 'mine' && (
        <>
          <ol className="mt-3 space-y-1 font-mono text-[12.5px]">
            {steps.map((s, i) => (
              <li key={s} className={i < step ? 'text-praise' : i === step ? 'text-ink' : 'text-subtle'}>
                {i < step ? '✓' : '○'} {s}
              </li>
            ))}
          </ol>
          <p className="label mt-2 text-subtle">This usually takes 20 to 40 seconds.</p>
        </>
      )}
      <div className="mt-4 space-y-2.5">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-2/3" />
      </div>
    </div>
  );
}

export function ErrorMessage({ message, onRetry, onBuy }: { message: string; onRetry?: () => void; onBuy?: () => void }) {
  return (
    <div className="rounded-2xl border border-gripe/35 bg-gripe/10 p-4 backdrop-blur" role="alert">
      <p className="leading-relaxed">{message}</p>
      {(onRetry || onBuy) && (
        <div className="mt-3 flex gap-2">
          {onBuy && (
            <button onClick={onBuy} className="rounded-full btn-primary px-4 py-2 text-sm font-semibold text-white">
              Add credits
            </button>
          )}
          {onRetry && (
            <button onClick={onRetry} className="rounded-full border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-white/10">
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
