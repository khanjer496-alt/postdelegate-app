import localFont from 'next/font/local';

// same variable file the marketing site ships, so the full 200-800 range is available
export const jakartaSans = localFont({
  src: [
    { path: './PlusJakartaSans.woff2', weight: '200 800', style: 'normal' },
    {
      path: './PlusJakartaSans-Italic.woff2',
      weight: '200 800',
      style: 'italic',
    },
  ],
  display: 'swap',
  variable: '--font-jakarta',
});
