/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#070811',
          850: '#0b0c16',
          800: '#10121f',
          750: '#151826',
          700: '#1b1f31',
          600: '#272c42',
        },
        line: '#262a40',
        bull: '#34d399',
        bear: '#fb6f84',
        flat: '#8b91ab',
        brand: {
          DEFAULT: '#7c6cff',
          300: '#b3a9ff',
          400: '#9b8dff',
          600: '#6450f0',
        },
        reddit: '#ff5414',
        valuepickr: '#27b3a8',
        news: '#ff8a3d',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124,108,255,0.35), 0 18px 50px -16px rgba(124,108,255,0.5)',
        card: '0 12px 34px -18px rgba(0,0,0,0.7)',
      },
    },
  },
  plugins: [],
};
