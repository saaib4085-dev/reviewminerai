export default function Logo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="rm-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#67E8F9" />
          <stop offset=".5" stopColor="#6E8BFF" />
          <stop offset="1" stopColor="#A78BFA" />
        </linearGradient>
      </defs>
      <path d="M16 3l11 6.5v13L16 29 5 22.5v-13z" fill="url(#rm-logo)" />
      <path d="M16 3v26M5 9.5l22 13M27 9.5l-22 13" stroke="#FFFFFF" strokeWidth="1.5" opacity=".55" />
    </svg>
  );
}
