'use client';

import { useVariables } from '@gitroom/react/helpers/variable.context';
import { Analytics as DubAnalyticsIn } from '@dub/analytics/react';
import { getCookie } from 'react-use-cookie';
import { useConsent } from '@gitroom/helpers/consent/use.consent';

// waits for the analytics choice in the cookie banner
export const DubAnalytics = () => {
  const { dub } = useVariables();
  const consent = useConsent();
  if (!dub || !consent?.analytics) return null;
  return (
    <DubAnalyticsIn
      domainsConfig={{
        refer: 'postdelegate.com',
      }}
    />
  );
};

export const useDubClickId = () => {
  const { dub } = useVariables();
  if (!dub) return undefined;

  const dubCookie = getCookie('dub_partner_data', '{}');
  return JSON.parse(dubCookie)?.clickId || undefined;
};
