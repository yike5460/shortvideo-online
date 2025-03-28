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
          50: '#fdf2f8',   // Lightest pink
          100: '#fce7f3',  // Light pink
          200: '#fbcfe8',  // Pink
          300: '#e879f9',  // Bright purple
          400: '#d946ef',  // Strong purple
          500: '#c026d3',  // Medium purple
          600: '#a21caf',  // Deep purple
          700: '#86198f',  // Dark purple
          800: '#be123c',  // Deep red
          900: '#9f1239',  // Dark red
          950: '#7f1d1d',  // Darkest red
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: '#e5e7eb',
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
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-out': 'fade-out 0.3s ease-out forwards',
      },
      transitionDuration: {
        '300': '300ms',
      },
      transitionProperty: {
        'all': 'all',
      },
    },
  },
  plugins: [],
}

export default config
