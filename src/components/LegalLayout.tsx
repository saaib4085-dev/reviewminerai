import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HOME_HREF, PRIVACY_HREF, SITE, TERMS_HREF } from '../lib/siteInfo';
import { startSmoothScroll } from '../lib/smoothScroll';
import { ScrollProgress } from './Ambient';
import Logo from './Logo';
import Reveal from './Reveal';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

interface Props {
  docTitle: string;
  title: string;
  accent: string;
  intro: string;
  sections: LegalSection[];
}

export default function LegalLayout({ docTitle, title, accent, intro, sections: SECTIONS }: Props) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const smoothRef = useRef<ReturnType<typeof startSmoothScroll>>(null);

  useEffect(() => {
    document.title = `${docTitle} · ${SITE.appName}`;
    window.scrollTo(0, 0);
    const smooth = startSmoothScroll();
    smoothRef.current = smooth;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -65% 0px' },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => {
      io.disconnect();
      smooth?.destroy();
      smoothRef.current = null;
      document.title = 'Review Miner – find out what buyers really think';
    };
  }, [docTitle, SECTIONS]);

  function go(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    if (smoothRef.current) {
      smoothRef.current.lenis.scrollTo(el, { offset: -90, duration: 1.2 });
      return;
    }
    const top = el.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  return (
    <div className="relative min-h-full overflow-x-clip">
      <ScrollProgress />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <span className="absolute left-[6%] top-[12%] h-72 w-72 rounded-full bg-violet-500/25 blur-3xl motion-safe:animate-drift" />
        <span className="absolute right-[8%] top-[30%] h-64 w-64 rounded-full bg-cyan-400/15 blur-3xl motion-safe:animate-drift" />
      </div>

      <header className="sticky top-0 z-30 border-b border-white/10 bg-night/30 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
          <a href={HOME_HREF} className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="font-display text-lg font-semibold tracking-tight">
              Review<span className="accent text-xl"> Miner</span>
            </span>
          </a>
          <a
            href={HOME_HREF}
            className="ml-auto rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-sm font-medium text-muted backdrop-blur transition-colors hover:border-white/40 hover:text-ink"
          >
            ← Back to {SITE.appName}
          </a>
        </nav>
      </header>

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 sm:pt-20">
        <p className="label text-cyan-200">Legal</p>
        <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-6xl">
          <span className="word mr-[0.25em]">{title}</span>
          <span className="word accent" style={{ animationDelay: '120ms' }}>
            {accent}
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted animate-page-in [animation-delay:200ms]">
          {intro}
        </p>
        <p className="label mt-4 text-subtle">Last updated {SITE.lastUpdated}</p>

        <div className="mt-12 grid gap-8 lg:grid-cols-[230px_1fr]">
          {/* Contents */}
          <aside className="hidden lg:block">
            <nav aria-label="On this page" className="glass sticky top-24 rounded-3xl p-3">
              <p className="label px-3 pb-2 pt-1 text-subtle">On this page</p>
              {SECTIONS.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => go(s.id)}
                  aria-current={active === s.id ? 'true' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-sm transition-all duration-300 ${
                    active === s.id ? 'bg-white/[0.1] text-ink shadow-[0_0_18px_-6px_rgba(130,120,255,0.8)]' : 'text-muted hover:translate-x-0.5 hover:text-ink'
                  }`}
                >
                  <span className="font-mono text-[11px] text-subtle">{String(i + 1).padStart(2, '0')}</span>
                  {s.title}
                </button>
              ))}
            </nav>
          </aside>

          {/* Policy text */}
          <article className="glass spotlight rounded-[2rem] p-6 sm:p-10">
            <div className="space-y-12">
              {SECTIONS.map((s, i) => (
                <Reveal key={s.id} as="section">
                  <section
                    id={s.id}
                    className="scroll-mt-24 space-y-4 leading-relaxed text-ink-soft [&_h3]:mt-6 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:text-ink [&_strong]:font-semibold [&_strong]:text-ink"
                  >
                    <h2 className="flex items-baseline gap-3 font-display text-2xl font-semibold tracking-[-0.02em] text-ink">
                      <span className="font-mono text-sm font-medium text-cyan-200">{String(i + 1).padStart(2, '0')}</span>
                      {s.title}
                    </h2>
                    {s.body}
                  </section>
                </Reveal>
              ))}
            </div>
          </article>
        </div>
      </main>

      <footer className="relative mx-auto flex max-w-6xl flex-col gap-3 border-t border-white/10 px-5 py-10 text-sm text-subtle sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2">
          <Logo className="h-5 w-5" /> {SITE.appName}
        </span>
        <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a href={TERMS_HREF} className="transition-colors hover:text-ink">
            Terms and Conditions
          </a>
          <a href={PRIVACY_HREF} className="transition-colors hover:text-ink">
            Privacy Policy
          </a>
          <span className="label">Questions? {SITE.contactEmail}</span>
        </span>
      </footer>
    </div>
  );
}
