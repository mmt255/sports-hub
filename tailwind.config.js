/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './lib/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0a',
        surface: '#141414',
        'surface-2': '#1e1e1e',
        border: '#2a2a2a',
        'text-primary': '#e5e5e5',
        'text-muted': '#888888',
      },
    },
  },
  plugins: [],
}
