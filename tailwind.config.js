/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './demo.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Glass theme: surfaces are translucent white over a blue–purple gradient.
        canvas: 'rgba(255,255,255,0.07)',
        paper: 'rgba(255,255,255,0.05)',
        line: 'rgba(255,255,255,0.14)',
        'line-strong': 'rgba(255,255,255,0.3)',
        ink: { DEFAULT: '#F4F6FF', soft: '#D7DCF6' },
        muted: 'rgba(232,236,255,0.74)',
        subtle: 'rgba(232,236,255,0.52)',
        gold: { DEFAULT: '#A78BFA', soft: 'rgba(167,139,250,0.2)', deep: '#E4DCFF' },
        praise: '#4ADE9A',
        gripe: '#FB7185',
        idea: '#C4B5FD',
        night: '#0E1240',
      },
      fontFamily: {
        // Headlines: geometric and modern
        display: ['Sora', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Body text: clean and very readable
        body: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Accent words inside headlines (always italic)
        serif: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
        // Numbers, credits, prices per prompt and small labels
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
        rise: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
        drift: { '0%,100%': { transform: 'translate(0,0)' }, '50%': { transform: 'translate(30px,-20px)' } },
        pop: { '0%': { opacity: '0', transform: 'translateY(10px) scale(0.96)' }, '100%': { opacity: '1', transform: 'none' } },
        fade: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-in': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'none' } },
        'page-in': { '0%': { opacity: '0', transform: 'translateY(24px)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        rise: 'rise .25s ease-out',
        drift: 'drift 18s ease-in-out infinite',
        pop: 'pop .35s cubic-bezier(.2,.8,.2,1) both',
        fade: 'fade .25s ease-out both',
        'slide-in': 'slide-in .35s cubic-bezier(.2,.8,.2,1) both',
        'page-in': 'page-in .5s cubic-bezier(.2,.8,.2,1) both',
      },
    },
  },
  plugins: [],
};
