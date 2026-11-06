'use client';

import { FC, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useConsent } from '@gitroom/helpers/consent/use.consent';
import { readCookieValue } from '@gitroom/helpers/consent/consent.cookie';
import {
  AFFILIATE_COOKIE_NAME,
  buildAffiliateCookieValue,
  DEFAULT_AFFILIATE_COOKIE_DAYS,
  parseAffiliateCookieValue,
  parseReferralCode,
} from '@gitroom/helpers/affiliate/affiliate.cookie';

// The first-party pd_ref cookie, read by the backend when the account is
// registered (first touch wins). It is written only while the referral and
// campaign category of the cookie banner is on, and removed when it is off.
// Without it the sign-up form sends the ?ref= code of the address instead.
export const AffiliateSaver: FC = () => {
  const query = useSearchParams();
  const { affiliateCookieDays, consentCookieDomain } = useVariables();
  const consent = useConsent();
  const ref = parseReferralCode(query.get('ref'));

  useEffect(() => {
    if (consent && !consent.ref) {
      // the marketing site writes it for the shared domain
      document.cookie = `${AFFILIATE_COOKIE_NAME}=; max-age=0; path=/`;
      if (consentCookieDomain) {
        document.cookie = `${AFFILIATE_COOKIE_NAME}=; max-age=0; path=/; domain=${consentCookieDomain}`;
      }
      return;
    }

    if (!ref || !consent?.ref) {
      return;
    }

    const days = affiliateCookieDays || DEFAULT_AFFILIATE_COOKIE_DAYS;
    if (
      parseAffiliateCookieValue(
        readCookieValue(document.cookie, AFFILIATE_COOKIE_NAME),
        days
      )
    ) {
      return;
    }

    document.cookie = `${AFFILIATE_COOKIE_NAME}=${buildAffiliateCookieValue(
      ref
    )}; max-age=${days * 24 * 60 * 60}; path=/; samesite=lax${
      window.location.protocol === 'https:' ? '; secure' : ''
    }`;
  }, [ref, consent, affiliateCookieDays, consentCookieDomain]);

  return null;
};
