import type { ReactNode } from 'react';
import { SITE } from '../lib/siteInfo';

export const Mail = () => (
  <a href={`mailto:${SITE.contactEmail}`} className="font-medium text-cyan-200 underline decoration-cyan-200/40 underline-offset-4 hover:decoration-cyan-200">
    {SITE.contactEmail}
  </a>
);

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-cyan-200 underline decoration-cyan-200/40 underline-offset-4 hover:decoration-cyan-200">
      {children}
    </a>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-cyan-300 to-violet-400" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

