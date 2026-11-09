import type { Analysis, Frequency, ThemeItem } from '../../shared/types';
import { hostOf, reportToText } from '../lib/format';
import CopyButton from './CopyButton';

const FREQ: Record<Frequency, { bars: number; label: string }> = {
  many: { bars: 3, label: 'Lots of people' },
  some: { bars: 2, label: 'Some people' },
  few: { bars: 1, label: 'A few people' },
};

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label={`Rated ${value} out of 5`}>
      <span className="relative whitespace-nowrap text-base leading-none tracking-[2px] text-line-strong" aria-hidden="true">
        ★★★★★
        <span className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-gold" style={{ width: `${(value / 5) * 100}%` }}>
          ★★★★★
        </span>
      </span>
      <span className="font-mono font-medium">{value.toFixed(1)}</span>
    </span>
  );
}

function SectionTitle({ color, children }: { color: string; children: string }) {
  return (
    <h3 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />
      {children}
    </h3>
  );
}

function Meter({ level, tone }: { level: Frequency; tone: string }) {
  const f = FREQ[level];
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs text-subtle">
      <span className="label hidden sm:inline">{f.label}</span>
      <span className="flex items-end gap-0.5" aria-label={f.label} role="img">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`grow-y w-1.5 rounded-sm ${i <= f.bars ? tone : 'bg-line'}`} style={{ height: `${6 + i * 4}px`, animationDelay: `${300 + i * 90}ms` }} />
        ))}
      </span>
    </span>
  );
}

function ThemeList({ title, items, color, empty }: { title: string; items: ThemeItem[]; color: string; empty: string }) {
  return (
    <section>
      <SectionTitle color={color}>{title}</SectionTitle>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2">
          {items.map((t, i) => (
            <li key={i} className="border-t border-line py-3 first:border-0">
              <div className="flex items-start justify-between gap-4">
                <span className="font-medium">{t.theme}</span>
                <Meter level={t.frequency} tone={color} />
              </div>
              {t.detail && <p className="mt-1 text-sm text-muted">{t.detail}</p>}
              {t.quote && (
                <blockquote className="mt-2 border-l-2 border-gold pl-3 text-sm italic text-ink-soft">“{t.quote}”</blockquote>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ResultCard({ analysis }: { analysis: Analysis }) {
  const r = analysis.report;
  const want = new Set(analysis.focuses);
  const s = r.sentiment;

  return (
    <article className="glass spotlight overflow-hidden rounded-2xl animate-pop">
      <header className="border-b border-line p-5 sm:p-6">
        <a
          href={analysis.url}
          target="_blank"
          rel="noreferrer"
          className="label text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {hostOf(analysis.url)} ↗
        </a>
        <h2 className="mt-1 font-display text-2xl font-semibold leading-tight tracking-[-0.03em]">{r.product_name}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {r.average_rating !== null && <Stars value={r.average_rating} />}
          {r.review_count !== null && <span className="label text-muted">{r.review_count.toLocaleString()} reviews</span>}
          {r.data_quality === 'limited' && (
            <span className="rounded-full bg-gold-soft px-2.5 py-0.5 text-xs font-medium text-gold-deep">
              Only a few reviews found
            </span>
          )}
        </div>
      </header>

      <div className="stagger space-y-8 p-5 sm:p-6">
        <section>
          <h3 className="font-display text-lg font-semibold tracking-tight">The <span className="accent text-xl">short</span> version</h3>
          <p className="mt-2 max-w-prose leading-relaxed">{r.verdict}</p>

          <div className="mt-5">
            <div
              className="grow-x flex h-3 gap-0.5 overflow-hidden rounded-full bg-line"
              role="img"
              aria-label={`${s.positive}% happy, ${s.neutral}% mixed, ${s.negative}% unhappy`}
            >
              <div className="bg-praise" style={{ width: `${s.positive}%` }} />
              <div className="bg-line-strong" style={{ width: `${s.neutral}%` }} />
              <div className="bg-gripe" style={{ width: `${s.negative}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted [&_.font-semibold]:font-mono [&_.font-semibold]:font-medium">
              <span><span className="font-semibold text-praise">{s.positive}%</span> happy</span>
              <span><span className="font-semibold text-ink">{s.neutral}%</span> mixed</span>
              <span><span className="font-semibold text-gripe">{s.negative}%</span> unhappy</span>
            </div>
          </div>
        </section>

        {r.answer && (
          <section className="rounded-2xl bg-gold-soft p-4">
            <h3 className="font-display font-semibold text-gold-deep">Your question</h3>
            {analysis.question && <p className="mt-1 text-sm text-muted">{analysis.question}</p>}
            <p className="mt-2 leading-relaxed">{r.answer}</p>
          </section>
        )}

        {want.has('love') && (
          <ThemeList title="What people love" items={r.love} color="bg-praise" empty="No clear praise came up in the reviews." />
        )}
        {want.has('complaints') && (
          <ThemeList
            title="Common complaints"
            items={r.complaints}
            color="bg-gripe"
            empty="No repeated complaints came up. That’s a good sign."
          />
        )}

        {want.has('wishes') && (
          <section>
            <SectionTitle color="bg-idea">What they wish it had</SectionTitle>
            {r.wishes.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Buyers didn’t ask for anything specific.</p>
            ) : (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {r.wishes.map((w, i) => (
                  <li key={i} className="hover-lift rounded-xl bg-paper p-3.5 hover:bg-white/[0.08]">
                    <p className="font-medium">{w.idea}</p>
                    {w.detail && <p className="mt-1 text-sm text-muted">{w.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {want.has('buyers') && (
          <section>
            <SectionTitle color="bg-sky-400">Who’s buying it</SectionTitle>
            {r.buyers.length === 0 ? (
              <p className="mt-2 text-sm text-muted">The reviews don’t say much about who the buyers are.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {r.buyers.map((b, i) => (
                  <li key={i} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                    <span className="w-fit shrink-0 rounded-full bg-sky-400/15 px-3 py-1 text-sm font-medium text-sky-200 ring-1 ring-sky-300/25">
                      {b.type}
                    </span>
                    <span className="text-sm text-muted">{b.why}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {want.has('ads') && (
          <section>
            <div className="flex items-center justify-between gap-3">
              <SectionTitle color="bg-gold">Ad ideas</SectionTitle>
              {r.ads.length > 1 && (
                <CopyButton text={r.ads.map((a) => `${a.headline}\n${a.body}`).join('\n\n')} label="Copy all" />
              )}
            </div>
            {r.ads.length === 0 ? (
              <p className="mt-2 text-sm text-muted">There wasn’t enough in the reviews to write honest ads.</p>
            ) : (
              <div className="mt-3 grid gap-3">
                {r.ads.map((ad, i) => (
                  <div key={i} className="hover-lift rounded-xl bg-paper p-4 hover:bg-white/[0.08]">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-serif text-xl italic leading-snug">{ad.headline}</p>
                      <CopyButton text={`${ad.headline}\n${ad.body}`} />
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{ad.body}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <footer className="flex flex-col gap-3 border-t border-line bg-white/[0.03] px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="label text-subtle">{r.data_note || 'Based on the reviews visible on the page.'}</p>
        <CopyButton text={reportToText(analysis)} label="Copy report" />
      </footer>
    </article>
  );
}
