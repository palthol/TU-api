/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        temple: {
          ink: '#0B0C0E',
          charcoal: '#272727',
          snow: '#F2F2F2',
          accent: '#E4B744',
          red: '#8E1E1E',
          bronze: '#9E6B4B',
          gold: '#D4AF37',
          shadow: '#332E35',
          plum: '#5E496A',
        },
      },
      boxShadow: {
        soft: '0 14px 40px -20px rgba(51, 46, 53, 0.45)',
      },
      backgroundImage: {
        'hero-glow':
          'radial-gradient(circle at 20% 15%, rgba(212, 175, 55, 0.16), transparent 40%), radial-gradient(circle at 82% 10%, rgba(142, 30, 30, 0.22), transparent 36%)',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}
