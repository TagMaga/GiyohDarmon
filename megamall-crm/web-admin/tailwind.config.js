/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      colors: {
        // Sidebar palette — dark slate with indigo accent
        sidebar: {
          bg:          '#0b1120',
          item:        '#1e293b',
          active:      '#4f46e5',
          hover:       'rgba(255,255,255,0.07)',
          border:      '#1e293b',
          text:        '#94a3b8',
          textActive:  '#ffffff',
          logo:        '#e2e8f0',
        },
      },
      boxShadow: {
        card:       '0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px rgba(16, 24, 40, 0.06)',
        'card-md':  '0 2px 4px rgba(16, 24, 40, 0.04), 0 12px 32px rgba(16, 24, 40, 0.08)',
        'card-lg':  '0 2px 4px rgba(16, 24, 40, 0.04), 0 12px 32px rgba(16, 24, 40, 0.08), 0 24px 48px rgba(16, 24, 40, 0.04)',
        topbar:     '0 1px 0 0 rgba(226, 232, 240, 0.8)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'pulse-slow':     'pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':        'fadeIn 0.2s ease-out',
        'slide-in':       'slideIn 0.25s ease-out',
        'slide-in-right': 'slideInRight 0.22s ease-out',
        'slide-in-up':    'slideInUp 0.28s cubic-bezier(0.32,0.72,0,1)',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%':   { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          '0%':   { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInUp: {
          '0%':   { opacity: '0', transform: 'translateY(32px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
