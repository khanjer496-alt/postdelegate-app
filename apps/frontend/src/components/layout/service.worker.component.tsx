'use client';

import { FC, useEffect } from 'react';

// Registers public/sw.js so the app can be installed (Add to Home Screen)
// and shows an offline page. The worker never caches API calls or pages.
export const ServiceWorkerComponent: FC = () => {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      !('serviceWorker' in navigator)
    ) {
      return;
    }
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => {
          // not installable in this browser, the app works the same
        });
    };
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
};
