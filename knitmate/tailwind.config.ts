import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#EDBBA4',
        secondary: '#CF9B71',
        accent: '#9B9C8A',
        light: '#EBDBD4',
        warm: '#C49270',
        bluegray: '#C4CDCC',
        brand: {
          dark: '#142F32',
          darker: '#282930',
          light: '#E3FFCC',
          gray: '#777C90',
          bg: '#F8F9FA',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        heading: ['Poppins', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
