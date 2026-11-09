import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { DEFAULT_FOCUSES, type FocusKey } from '../../shared/types';
import { savePendingPack, savePendingPrompt } from '../lib/pending';
import { sampleAnalysis } from '../lib/sample';
import AuthModal from './AuthModal';
import Composer from './Composer';
import GoogleButton from './GoogleButton';
import Toast from './Toast';
import { takeAuthRedirectError } from '../lib/auth';
import { peekPendingVoucher } from '../lib/voucher';
import { PRIVACY_HREF, TERMS_HREF } from '../lib/siteInfo';
import Logo from './Logo';
import Reveal from './Reveal';
import { CursorGlow, ScrollProgress } from './Ambient';
import { startSmoothScroll } from '../lib/smoothScroll';
import PricingTiers from './PricingTiers';
import ResultCard from './ResultCard';
import { AssistantRow, UserMessage } from './ThreadItems';

const STEPS = [
  ['Paste your links', 'Add up to 5 product pages that show customer reviews. Each link uses 1.5 credits.'],
  ['Pick what matters', 'Tick the topics you care about, or type your own question after the link.'],
  ['Read, compare, ask more', 'Get a clear report for each product, then ask follow-ups that compare them.'],
] as const;

const USES = [
  ['For online sellers', 'Find the complaints to fix in your product, or in a competitor’s, before your customers find them for you.'],
  ['For shoppers', 'Skip 2,000 reviews. Get the honest answer about what breaks, what’s great and who it’s really for.'],
  ['For marketers', 'Write ads in your customers’ own words, with angles taken straight from what real buyers praise.'],
] as const;

const FAQS = [
  ['Which websites work?', 'Most product pages that show reviews on the page. A few big stores block automatic readers. If that happens, we tell you and no credit is used.'],
  ['What is a credit?', 'Each product link you add uses 1.5 credits, so 3 links use 4.5 credits. Each follow-up question also uses 1.5. You get 15 free credits when you sign up (10 links), and bought credits never expire.'],
  ['Which pack should I pick?', 'Most people start with Core or Pro. If you check products every week, Elite and Apex cost far less per product.'],
  ['Do I get charged if it fails?', 'No. Credits are only used when you get a real result. Blocked pages, errors and pages with no reviews are free.'],
  ['Are the quotes real?', 'Yes. Review Miner only uses what’s on the page you share. It never makes up reviews, numbers or quotes.'],
  ['Can I delete my chats?', 'Any time. Close a single chat from the sidebar, or delete everything in Settings.'],
] as const;

const TICKER = [
  'Does it run small?',
  'Is it loud?',
  'How long does the battery last?',
  'Is it easy to clean?',
  'Worth it for a small kitchen?',
  'Does it break after a month?',
  'Good gift for a teenager?',
  'Is the app any good?',
  'Does the colour match the photos?',
  'Is it safe for kids?',
];

export default function HomePage() {
  const [auth, setAuth] = useState<null | 'login' | 'signup'>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    const authError = takeAuthRedirectError();
    if (authError) return authError;
    const code = peekPendingVoucher();
    return code ? `Sign up or log in to add the credits from voucher ${code}.` : null;
  });
  const closeNotice = useCallback(() => setNotice(null), []);
  const [focuses, setFocuses] = useState<FocusKey[]>(DEFAULT_FOCUSES);
  const smooth = useRef<ReturnType<typeof startSmoothScroll>>(null);

  useEffect(() => {
    smooth.current = startSmoothScroll();
    return () => {
      smooth.current?.destroy();
      smooth.current = null;
    };
  }, []);

  // Shareable buy link: yoursite.com/#buy jumps to pricing and opens the packs after sign-up.
  useEffect(() => {
    if (window.location.hash !== '#buy') return;
    try {
      sessionStorage.setItem('review-miner:open-pricing', '1');
    } catch {
      /* storage unavailable */
    }
    const t = window.setTimeout(() => {
      const target = document.getElementById('pricing');
      if (target) {
        if (smooth.current) smooth.current.lenis.scrollTo(target, { offset: -72, duration: 1.2 });
        else target.scrollIntoView();
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, []);

  // Voucher link while signed out: open sign-up; the code is redeemed right after.
  useEffect(() => {
    if (peekPendingVoucher()) setAuth('signup');
  }, []);

  // Freeze the page behind the sign-in window.
  useEffect(() => {
    if (auth) smooth.current?.lenis.stop();
    else smooth.current?.lenis.start();
  }, [auth]);

  function jump(e: MouseEvent<HTMLAnchorElement>) {
    const id = e.currentTarget.getAttribute('href') ?? '';
    const target = id.length > 1 ? document.querySelector<HTMLElement>(id) : null;
    if (!target || !smooth.current) return;
    e.preventDefault();
    smooth.current.lenis.scrollTo(id === '#top' ? 0 : target, { offset: -72, duration: 1.4 });
  }

  function startFromHero(text: string): boolean {
    savePendingPrompt(text, focuses);
    setAuth('signup');
    return true;
  }

  return (
    <div className="relative min-h-full overflow-x-clip">
      <ScrollProgress />
      <CursorGlow />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <span className="absolute left-[8%] top-[18%] h-72 w-72 rounded-full bg-violet-500/25 blur-3xl motion-safe:animate-drift" />
        <span className="absolute right-[6%] top-[8%] h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl motion-safe:animate-drift" />
        <span className="absolute bottom-[6%] left-[40%] h-80 w-80 rounded-full bg-blue-500/20 blur-3xl motion-safe:animate-drift" />
      </div>

      {/* Navigation */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-night/30 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:gap-8">
          <a href="#top" onClick={jump} className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <Logo className="h-7 w-7" />
            <span className="hidden font-display text-lg font-semibold tracking-tight min-[400px]:inline">Review<span className="accent text-xl"> Miner</span></span>
          </a>
          <div className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a href="#how" onClick={jump} className="transition-colors hover:text-ink">How it works</a>
            <a href="#pricing" onClick={jump} className="transition-colors hover:text-ink">Pricing</a>
            <a href="#faq" onClick={jump} className="transition-colors hover:text-ink">Questions</a>
          </div>
          <div className="ml-auto flex items-center gap-1 whitespace-nowrap sm:gap-2">
            <button onClick={() => setAuth('login')} className="rounded-full px-4 py-2 text-sm font-semibold hover:bg-white/10">
              Log in
            </button>
            <button onClick={() => setAuth('signup')} className="rounded-full btn-primary px-4 py-2 text-sm font-semibold text-white">
              Get started
            </button>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section id="top" className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 sm:pt-24">
        <h1 className="max-w-4xl pb-2 font-display text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-7xl lg:text-[5.5rem]">
          <span className="word mr-[0.25em]">Every</span>
          <span className="word mr-[0.25em]" style={{ animationDelay: '90ms' }}>
            review,
          </span>
          <span className="word accent" style={{ animationDelay: '220ms' }}>
            read for you.
          </span>
        </h1>
        <Reveal as="p" delay={350} className="mt-6 max-w-xl text-lg leading-relaxed text-muted sm:text-xl">
          Paste a product link. Review Miner reads the reviews and tells you what people love, what bugs them and what they
          wish it did, in plain English.
        </Reveal>
        <Reveal delay={500} className="mt-10 max-w-2xl">
          <Composer mode="start" focuses={focuses} onFocusesChange={setFocuses} onSend={startFromHero} autoFocus={false} />
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 px-1">
            <GoogleButton onError={() => setAuth('signup')} />
            <p className="label text-subtle">15 free credits · No card needed</p>
          </div>
        </Reveal>
      </section>

      {/* Product shot */}
      <section className="mx-auto max-w-6xl px-5">
        <Reveal className="glass spotlight rounded-[2rem] p-3 sm:p-8 lg:p-12">
          <div className="relative mx-auto max-h-[640px] max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-night/40 p-4 [mask-image:linear-gradient(to_bottom,black_70%,transparent)] sm:p-8">
            <div className="space-y-6">
              <UserMessage urls={[sampleAnalysis.url]} question={sampleAnalysis.question ?? undefined} focuses={sampleAnalysis.focuses} />
              <AssistantRow>
                <p className="mb-3 leading-relaxed">Here’s what buyers are saying:</p>
                <ResultCard analysis={sampleAnalysis} />
              </AssistantRow>
            </div>
          </div>
          <p className="label mt-4 text-center text-subtle">A real report layout, shown with a sample product</p>
        </Reveal>
      </section>

      {/* Question ticker */}
      <section className="mt-20" aria-label="Questions people ask">
        <Reveal as="p" className="label mb-5 text-center text-subtle">
          Ask anything buyers would know
        </Reveal>
        <div className="marquee overflow-hidden py-2">
          <div className="marquee-track gap-3 pr-3">
            {[...TICKER, ...TICKER].map((q, i) => (
              <span
                key={i}
                aria-hidden={i >= TICKER.length}
                className="glass whitespace-nowrap rounded-full px-5 py-2.5 font-serif text-xl italic text-white/90"
              >
                “{q}”
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24 sm:py-32">
        <Reveal as="div" className="max-w-2xl"><h2 className="font-display text-4xl font-semibold leading-tight tracking-[-0.03em] sm:text-5xl">
          From link to answer <span className="accent">in under a minute.</span>
        </h2></Reveal>
        <ol className="mt-14 grid gap-10 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <Reveal as="li" key={title} delay={i * 120} className="flex">
              <div className="glass spotlight hover-lift w-full rounded-3xl p-6">
              <span className="label rounded-full border border-white/20 bg-white/[0.06] px-3 py-1 text-cyan-200">Step 0{i + 1}</span>
              <h3 className="mt-5 font-display text-xl font-semibold tracking-tight">{title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* Use cases */}
      <section className="border-y border-white/10 bg-white/[0.04] backdrop-blur-xl">
        <div className="mx-auto grid max-w-6xl gap-px px-5 py-24 sm:py-28 md:grid-cols-3 md:gap-12">
          {USES.map(([title, body], i) => (
            <Reveal key={title} delay={i * 120} className="py-6 md:py-0">
              <h3 className="font-display text-2xl font-semibold tracking-tight">{title}</h3>
              <p className="mt-3 text-lg leading-relaxed text-muted">{body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-24 sm:py-32">
        <Reveal><h2 className="max-w-3xl font-display text-4xl font-semibold leading-tight tracking-[-0.03em] sm:text-6xl">
          Pay once. <span className="accent">Use whenever.</span>
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          No subscription. Start with 15 free credits, then pick a pack when you need more.
        </p></Reveal>
        <div className="mt-12">
          <PricingTiers
            onChoose={(pack) => {
              savePendingPack(pack);
              setAuth('signup');
            }}
          />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 pb-24 sm:pb-32">
        <h2 className="font-display text-4xl font-semibold tracking-tight">
          Good <span className="accent">questions</span>
        </h2>
        <Reveal className="glass spotlight mt-8 divide-y divide-line rounded-3xl px-6">
          {FAQS.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer items-center justify-between gap-4 font-display text-lg font-medium tracking-tight">
                {q}
                <span className="text-2xl font-light text-muted transition-transform group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="mt-3 leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </Reveal>
      </section>

      {/* Closing call to action */}
      <section className="relative overflow-hidden border-y border-white/15 bg-gradient-to-br from-blue-600/40 via-violet-600/40 to-fuchsia-600/30 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:py-28">
          <Reveal><h2 className="max-w-3xl font-display text-4xl font-semibold leading-tight tracking-[-0.03em] sm:text-6xl">
            Stop scrolling <span className="accent">through reviews.</span>
          </h2></Reveal>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <GoogleButton className="px-7 py-3.5" onError={() => setAuth('signup')} />
            <button
              onClick={() => setAuth('signup')}
              className="rounded-full border border-white/40 bg-white/10 px-7 py-3.5 font-semibold backdrop-blur transition-all duration-300 hover:bg-white/20 active:scale-[0.98]"
            >
              Sign up with email
            </button>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-10 text-sm text-subtle sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2">
          <Logo className="h-5 w-5" /> Review Miner
        </span>
        <span>Summaries are based only on the reviews shown on the page you share.</span>
        <span className="flex gap-5">
          <a href={TERMS_HREF} className="transition-colors hover:text-ink">
            Terms
          </a>
          <a href={PRIVACY_HREF} className="transition-colors hover:text-ink">
            Privacy Policy
          </a>
        </span>
      </footer>

      <Toast message={notice} onClose={closeNotice} />
      {auth && <AuthModal intent={auth} onClose={() => setAuth(null)} />}
    </div>
  );
}
