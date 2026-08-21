/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        // Les familles du template Azia, auto-hébergées (src/assets/fonts) :
        // le CSP de nginx bloque le CDN Google, et une fonte déclarée mais non
        // servie retombe silencieusement sur celle du système.
        sans: ['Roboto', 'system-ui', 'sans-serif'],
        display: ['Montserrat', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Gris à bias bleu — Azia _variables.scss
        gray: {
          100: 'var(--gray-100)',
          200: 'var(--gray-200)',
          300: 'var(--gray-300)',
          400: 'var(--gray-400)',
          500: 'var(--gray-500)',
          600: 'var(--gray-600)',
          700: 'var(--gray-700)',
          800: 'var(--gray-800)',
          900: 'var(--gray-900)',
        },
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        headline: 'var(--headline)',
        ink: {
          DEFAULT: 'var(--ink)',
          soft: 'var(--ink-soft)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
        },
        rule: {
          DEFAULT: 'var(--rule)',
          strong: 'var(--rule-strong)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          wash: 'var(--primary-wash)',
        },
        secondary: 'var(--secondary)',
        teal: 'var(--teal)',
        gold: { DEFAULT: 'var(--gold)', wash: 'var(--gold-wash)' },
        // Sémantique — réservée au statut métier (§ 17.2).
        ok: { DEFAULT: 'var(--ok)', wash: 'var(--ok-wash)' },
        warn: { DEFAULT: 'var(--warn)', ink: 'var(--warn-ink)', wash: 'var(--warn-wash)' },
        info: { DEFAULT: 'var(--info)', wash: 'var(--info-wash)' },
        crit: { DEFAULT: 'var(--crit)', wash: 'var(--crit-wash)' },
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
      },
    },
  },
  plugins: [],
};
