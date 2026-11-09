import { useState } from 'react';
import type { HealthCheck, HealthResponse } from '../../shared/types';
import { api, toApiError } from '../lib/api';

const ICON: Record<HealthCheck['status'], string> = { ok: '✓', warn: '!', fail: '✕' };
const TONE: Record<HealthCheck['status'], string> = {
  ok: 'bg-emerald-300 text-night',
  warn: 'bg-amber-300 text-night',
  fail: 'bg-rose-400 text-white',
};

/** One-click check of the live setup: Supabase, Stripe, webhook, Anthropic and Firecrawl. */
export default function SystemCheck() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState('running');
    setError(null);
    try {
      const res = await api.adminHealth();
      setResult(res);
      setState('done');
    } catch (e) {
      setError(toApiError(e).message);
      setState('error');
    }
  }

  const counts = result
    ? { ok: result.checks.filter((c) => c.status === 'ok').length, warn: result.checks.filter((c) => c.status === 'warn').length, fail: result.checks.filter((c) => c.status === 'fail').length }
    : null;
  const groups = result ? [...new Set(result.checks.map((c) => c.group))] : [];

  return (
    <section className="glass mt-8 rounded-3xl p-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold tracking-tight">System check</h2>
          <p className="mt-1 text-sm text-muted">
            Tests your live setup with your real keys: Supabase, Stripe (key permissions, prices, payment methods, webhook), Anthropic and Firecrawl.
            Opens one test Stripe checkout page and closes it at once; nobody is charged.
          </p>
        </div>
        <button onClick={run} disabled={state === 'running'} className="btn-primary rounded-full px-6 py-3 font-semibold">
          {state === 'running' ? 'Checking…' : state === 'done' ? 'Check again' : 'Run system check'}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-rose-200" role="alert">{error}</p>}

      {result && counts && (
        <div className="mt-6 animate-pop">
          <p className={`rounded-2xl px-4 py-3 text-sm font-semibold ${counts.fail ? 'bg-rose-400/15 text-rose-100' : counts.warn ? 'bg-amber-300/15 text-amber-100' : 'bg-emerald-300/15 text-emerald-100'}`}>
            {counts.fail
              ? `${counts.fail} problem${counts.fail > 1 ? 's' : ''} to fix before taking payments.`
              : counts.warn
                ? `Ready to take payments, with ${counts.warn} thing${counts.warn > 1 ? 's' : ''} worth a look.`
                : 'Everything is set up. You’re ready to take payments.'}
          </p>
          {groups.map((g) => (
            <div key={g} className="mt-5">
              <p className="label mb-2 text-white/55">{g}</p>
              <ul className="space-y-2">
                {result.checks.filter((c) => c.group === g).map((c) => (
                  <li key={c.label} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${TONE[c.status]}`} aria-label={c.status}>
                      {ICON[c.status]}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{c.label}</span>
                      <span className="block text-sm text-white/70">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
