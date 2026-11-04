/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Royal blue scale (primary) with a luminous accent; royal red + luminous red for danger.
        brand: { 50: '#eef3ff', 100: '#dbe5ff', 500: '#3763f0', 600: '#1f46d6', 700: '#1737b0', 900: '#0a1a5c' },
        lumi: { blue: '#3da5ff', red: '#ff4560' },
        royal: { red: '#c1121f' },
      },
      fontFamily: { sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
