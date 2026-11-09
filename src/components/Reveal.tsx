import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { prefersReducedMotion } from '../lib/motion';

interface Props {
  as?: 'div' | 'section' | 'li' | 'p' | 'span';
  delay?: number;
  className?: string;
  children: ReactNode;
}

/** Fades, lifts and un-blurs its content the first time it scrolls into view. */
export default function Reveal({ as = 'div', delay = 0, className = '', children }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return createElement(
    as,
    {
      ref,
      className: `reveal ${visible ? 'is-visible' : ''} ${className}`,
      style: { '--reveal-delay': `${delay}ms` } as CSSProperties,
    },
    children,
  );
}
