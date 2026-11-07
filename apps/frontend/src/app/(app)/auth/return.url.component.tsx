'use client';

import { useSearchParams } from 'next/navigation';
import { FC, useCallback, useEffect } from 'react';

// Only an address on this app, so signing in can never send someone to
// another site or run a javascript: URL
export const sameOriginUrl = (url: string | null) => {
  if (!url) {
    return null;
  }
  try {
    // a path (/launches?x=1) is read against this app
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin &&
      parsed.protocol === window.location.protocol
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
};

const ReturnUrlComponent: FC = () => {
  const params = useSearchParams();
  const url = params.get('returnUrl');
  useEffect(() => {
    const returnUrl = sameOriginUrl(url);
    if (returnUrl) {
      localStorage.setItem('returnUrl', returnUrl);
    }
  }, [url]);
  return null;
};
export const useReturnUrl = () => {
  return {
    getAndClear: useCallback(() => {
      const data = localStorage.getItem('returnUrl');
      localStorage.removeItem('returnUrl');
      // also on read: localStorage can hold a value saved before this check
      return sameOriginUrl(data);
    }, []),
  };
};
export default ReturnUrlComponent;
