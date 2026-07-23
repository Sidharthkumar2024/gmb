/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ---------------------------------------------------------------
        // Adgrowly GMB Suite tokens, transcribed from the design file.
        // Namespaced under `gmb` so they sit alongside the inherited
        // `primary` scale without disturbing pages that still use it.
        // Screens should use these and never a raw hex.
        // ---------------------------------------------------------------
        gmb: {
          canvas: "#f5f5f8",
          surface: "#ffffff",
          subtle: "#fafafc",

          brand: "#5a4af0",
          "brand-hover": "#4536d6",
          "brand-light": "#6d5efc",
          "brand-lighter": "#8b7bff",
          "brand-tint": "#ece8ff",
          "brand-wash": "#f7f5ff",
          "brand-border": "#ded8ff",

          ink: "#15131f",
          "ink-muted": "#56536a",
          "ink-subtle": "#8d8aa3",

          line: "#ececf1",
          "line-soft": "#f0eff5",

          ok: "#16803c",
          "ok-bg": "#eaf7ef",
          "ok-dot": "#22c55e",
          warn: "#b25e09",
          "warn-bg": "#fef3e2",
          danger: "#d92d20",
          "danger-bg": "#fdecea",

          night: "#1a1726",
          "night-soft": "#2c2839",
          "night-deep": "#2c2452",
        },
        // Admin console (dark) tokens from the GMB Admin design file.
        adm: {
          bg: "#131120",
          panel: "#1a1729",
          "panel-hover": "#1f1b30",
          line: "#2b2740",
          ink: "#edecf4",
          muted: "#a29fb8",
          subtle: "#6b6880",
          accent: "#b3a9ff",
          "accent-hover": "#d1cbff",
          ok: "#7dd8a0",
          hero: "#241d3f",
        },
        // Nexa design system primary (indigo/violet, Adgrowly panel style).
        // Driven by CSS variables so white-label partners can re-theme at
        // runtime by overriding --nx-primary-* (see globals.css :root).
        primary: {
          50: 'rgb(var(--nx-primary-50) / <alpha-value>)',
          100: 'rgb(var(--nx-primary-100) / <alpha-value>)',
          200: 'rgb(var(--nx-primary-200) / <alpha-value>)',
          300: 'rgb(var(--nx-primary-300) / <alpha-value>)',
          400: 'rgb(var(--nx-primary-400) / <alpha-value>)',
          500: 'rgb(var(--nx-primary-500) / <alpha-value>)',
          600: 'rgb(var(--nx-primary-600) / <alpha-value>)',
          700: 'rgb(var(--nx-primary-700) / <alpha-value>)',
          800: 'rgb(var(--nx-primary-800) / <alpha-value>)',
          900: 'rgb(var(--nx-primary-900) / <alpha-value>)',
          950: 'rgb(var(--nx-primary-950) / <alpha-value>)',
        },
        // Enhanced accent colors
        accent: {
          purple: '#8b5cf6',
          pink: '#ec4899',
          orange: '#f97316',
          teal: '#14b8a6',
        },
        // Modern neutral scale
        neutral: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a',
        },
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'gradient-success': 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
        'gradient-warning': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'gradient-info': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'gradient-dark': 'linear-gradient(135deg, #434343 0%, #000000 100%)',
        'gradient-sunset': 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        'gradient-ocean': 'linear-gradient(135deg, #2E3192 0%, #1BFFFF 100%)',
        'gradient-purple': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)',
        'medium': '0 4px 20px -2px rgba(0, 0, 0, 0.1), 0 8px 25px -3px rgba(0, 0, 0, 0.08)',
        'large': '0 10px 40px -5px rgba(0, 0, 0, 0.15), 0 15px 30px -5px rgba(0, 0, 0, 0.1)',
        'glow-primary': '0 0 20px rgba(99, 102, 241, 0.3)',
        'glow-success': '0 0 20px rgba(16, 185, 129, 0.3)',
        'glow-warning': '0 0 20px rgba(245, 158, 11, 0.3)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-down': 'slideDown 0.4s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
        // GMB Suite: the design uses 9px controls and 16/18px cards.
        control: '9px',
        card: '16px',
        panel: '18px',
      },
      fontFamily: {
        geist: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        'geist-mono': ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // The design leans on half-pixel sizes; named so screens don't
        // sprinkle arbitrary values.
        micro: ['9px', { lineHeight: '1.3' }],
        tiny: ['10.5px', { lineHeight: '1.35' }],
        xs2: ['11.5px', { lineHeight: '1.4' }],
        sm2: ['12.5px', { lineHeight: '1.45' }],
      },
    },
  },
  plugins: [],
};
