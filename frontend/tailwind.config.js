/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        mind: {
          bg: '#1A1608',
          surface: '#28220E',
          panel: '#332A12',
          border: '#40361A',
          cyan: '#D4920B',
          purple: '#C8A84E',
          green: '#4CAF50',
          amber: '#f5b942',
          red: '#E85D24',
          worker: {
            idle: '#6B5A2A',
            planning: '#C8A84E',
            running: '#D4920B',
            hitl: '#f5b942',
            completed: '#4CAF50',
            error: '#E85D24',
          },
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'spin-slow': 'spin 4s linear infinite',
        'spin-reverse': 'spinReverse 3s linear infinite',
        'orbit': 'orbit 6s linear infinite',
        'shimmer': 'shimmer 2s ease-in-out infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'flicker': 'flicker 3s ease-in-out infinite',
        'data-flow': 'dataFlow 1.5s linear infinite',
        'fade-up': 'fadeUp 0.3s ease-out',
        'slide-right': 'slideRight 0.3s ease-out',
        'scanline': 'scanline 8s linear infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.02)' },
        },
        spinReverse: {
          from: { transform: 'rotate(360deg)' },
          to: { transform: 'rotate(0deg)' },
        },
        orbit: {
          from: { transform: 'rotate(0deg) translateX(60px) rotate(0deg)' },
          to: { transform: 'rotate(360deg) translateX(60px) rotate(-360deg)' },
        },
        shimmer: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        flicker: {
          '0%, 95%, 100%': { opacity: '1' },
          '96%': { opacity: '0.6' },
          '98%': { opacity: '0.8' },
        },
        dataFlow: {
          '0%': { strokeDashoffset: '100' },
          '100%': { strokeDashoffset: '0' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideRight: {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
      },
      backgroundImage: {
        'hex-pattern': "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V18L28 2l28 16v32L28 66zm0-2.67L54 50V19.33L28 4.67 2 19.33V50L28 63.33z' fill='%2340361A' fill-opacity='0.3'/%3E%3C/svg%3E\")",
        'neural-grid': "radial-gradient(circle at 1px 1px, rgba(212,146,11,0.08) 1px, transparent 0)",
        'glow-radial': 'radial-gradient(ellipse at center, rgba(212,146,11,0.12) 0%, transparent 70%)',
      },
    },
  },
  plugins: [],
}
