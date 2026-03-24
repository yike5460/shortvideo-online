import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        sidebar: {
          DEFAULT: '#0f172a',
          hover: '#1e293b',
          active: '#1e3a5f',
          border: '#1e293b',
          text: '#94a3b8',
          'text-active': '#f8fafc',
        },
        surface: {
          DEFAULT: '#ffffff',
          secondary: '#f8fafc',
          tertiary: '#f1f5f9',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: '#e2e8f0',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translate(-50%, 100%)' },
          '100%': { opacity: '1', transform: 'translate(-50%, 0)' },
        },
        'fade-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-out': 'fade-out 0.3s ease-out forwards',
        'slide-in-right': 'slide-in-right 0.2s ease-out',
      },
      fontSize: {
        'xxs': '0.625rem',
      },
    },
  },
  plugins: [],
}

export default config
