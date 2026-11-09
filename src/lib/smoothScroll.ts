import Lenis from 'lenis';
import { prefersReducedMotion } from './motion';

/** Starts inertia-style smooth scrolling for the page. Returns null when motion is reduced. */
export function startSmoothScroll(): { lenis: Lenis; destroy: () => void } | null {
  if (prefersReducedMotion()) return null;
  const lenis = new Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 1 });
  let frame = 0;
  const raf = (time: number) => {
    lenis.raf(time);
    frame = requestAnimationFrame(raf);
  };
  frame = requestAnimationFrame(raf);
  return {
    lenis,
    destroy: () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    },
  };
}
