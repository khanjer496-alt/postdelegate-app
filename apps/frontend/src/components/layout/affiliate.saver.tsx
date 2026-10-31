'use client';

import { FC, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import {
  AFFILIATE_CODE_REGEX,
  AFFILIATE_COOKIE_NAME,
  buildAffiliateCookieValue,
  DEFAULT_AFFILIATE_COOKIE_DAYS,
  parseAffiliateCookieValue,
} from '@gitroom/helpers/affiliate/affiliate.cookie';

const readCookie = () =>
  document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${AFFILIATE_COOKIE_NAME}=`))
    ?.slice(AFFILIATE_COOKIE_NAME.length + 1);

// A first-party cookie, the backend reads it when the account is registered.
// First touch wins: a valid cookie is never replaced by a later link.
export const AffiliateSaver: FC = () => {
  const query = useSearchParams();
  const { affiliateCookieDays } = useVariables();

  useEffect(() => {
    const ref = query.get('ref')?.trim().toLowerCase();
    if (!ref || !AFFILIATE_CODE_REGEX.test(ref)) {
      return;
    }

    const days = affiliateCookieDays || DEFAULT_AFFILIATE_COOKIE_DAYS;
    if (parseAffiliateCookieValue(readCookie(), days)) {
      return;
    }

    document.cookie = `${AFFILIATE_COOKIE_NAME}=${buildAffiliateCookieValue(
      ref
    )}; max-age=${days * 24 * 60 * 60}; path=/; samesite=lax${
      window.location.protocol === 'https:' ? '; secure' : ''
    }`;
  }, [query]);

  return null;
};
