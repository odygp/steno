/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Host Grotesk',
          '-apple-system',
          'BlinkMacSystemFont',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
