import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({
  title,
  onClose,
  children,
  wide = false,
  locked = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** While true, the window can't be closed (e.g. during a payment). */
  locked?: boolean;
}) {
  const close = () => {
    if (!locked) onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !locked && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, locked]);

  // Rendered on <body> so animated or scrolling parents can't move it off-screen.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-night/60 backdrop-blur-sm p-3 backdrop-blur-[2px] animate-fade sm:items-center sm:p-6" onClick={close} data-lenis-prevent>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`thin-scroll max-h-[90dvh] w-full overflow-y-auto glass-strong rounded-3xl animate-pop ${
          wide ? 'max-w-2xl' : 'max-w-md'
        }`}
      >
        <div className="flex items-center justify-between gap-4 px-6 pt-5">
          <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
          <button onClick={close} disabled={locked} className="grid h-8 w-8 disabled:opacity-30 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-6 pb-6 pt-3">{children}</div>
      </div>
    </div>
    ,
    document.body,
  );
}
