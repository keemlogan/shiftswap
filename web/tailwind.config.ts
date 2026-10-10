import type { Config } from 'tailwindcss';

// Design tokens of the prototype (app/styles.css) as theme colours. Breakpoints: 520 px (small phones),
// 720 px (tables become rows), 900 px (left navigation, 44 px buttons), 1200 px.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: { sm: '520px', md: '720px', lg: '900px', xl: '1200px' },
    extend: {
      colors: {
        ink: { DEFAULT: '#191F28', 2: '#4E5968', 3: '#8B95A1' },
        surface: '#F2F4F6',
        paper: '#FFFFFF',
        line: '#E5E8EB',
        primary: { DEFAULT: '#2B5BD7', press: '#2350C0', soft: '#EBF1FD' },
        handover: { DEFAULT: '#E9A23B', soft: '#FDF3E1', ink: '#8A5300' },
        alert: { DEFAULT: '#D93A30', soft: '#FDECEB', ink: '#9E231B' },
        ok: { DEFAULT: '#1F8A55', soft: '#E6F4EC', ink: '#145C39' },
        secondary: { DEFAULT: '#E8EBF0', press: '#DCE0E7' },
      },
      borderRadius: { card: '16px', btn: '12px' },
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui',
          '"Apple SD Gothic Neo"', '"Noto Sans KR"', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
