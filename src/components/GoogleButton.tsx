import { useState } from 'react';
import { signInWithGoogle } from '../lib/auth';

interface Props {
  label?: string;
  className?: string;
  onError?: (message: string) => void;
}

/** White "Sign up with Google" pill used on the home page and in the sign-in window. */
export default function GoogleButton({ label = 'Sign up with Google', className = '', onError }: Props) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    const error = await signInWithGoogle();
    if (error) {
      setBusy(false);
      onError?.(error);
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className={`inline-flex items-center justify-center gap-2.5 rounded-full bg-white px-6 py-3 font-semibold text-[#1f2340] shadow-[0_0_28px_rgba(255,255,255,0.35)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_40px_rgba(255,255,255,0.55)] active:scale-[0.98] disabled:opacity-70 ${className}`}
    >
      {busy ? (
        <span className="h-4 w-4 rounded-full border-2 border-[#1f2340]/30 border-t-[#1f2340] motion-safe:animate-spin" aria-hidden="true" />
      ) : (
        <span className="grid h-5 w-5 place-items-center rounded-full bg-[#1f2340] font-display text-[11px] font-bold text-white" aria-hidden="true">
          G
        </span>
      )}
      {busy ? 'Opening Google…' : label}
    </button>
  );
}
