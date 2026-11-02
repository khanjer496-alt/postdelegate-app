'use client';

import { FC, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocalStorage } from '@mantine/hooks';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useConsent } from '@gitroom/helpers/consent/use.consent';

// The campaign source of the link the visitor followed
export const getUtmFromQuery = (query: Pick<URLSearchParams, 'get'>) =>
  query.get('utm_source') || query.get('utm') || '';

// The campaign source is saved in the browser only while the referral and
// campaign category of the cookie banner is on, and removed when it is off
const UtmSaver: FC = () => {
  const query = useSearchParams();
  const [value, setValue, removeValue] = useLocalStorage({
    key: 'utm',
    defaultValue: '',
  });
  const fireEvents = useFireEvents();
  const consent = useConsent();

  // the Facebook pixel StartTrial is sent by the backend once Stripe confirms
  // the trial, firing it here as well would count it twice
  useEffect(() => {
    if (query.get('check')) {
      fireEvents('purchase');
    }
  }, []);

  // older versions saved the landing page and the referring page for every
  // visitor, nothing reads them, so they are cleared
  useEffect(() => {
    try {
      localStorage.removeItem('landingUrl');
      localStorage.removeItem('referrer');
    } catch (e) {
      // storage blocked, nothing was saved either
    }
  }, []);

  useEffect(() => {
    if (consent && !consent.ref) {
      removeValue();
      return;
    }

    const utm = getUtmFromQuery(query);
    if (utm && !value && consent?.ref) {
      setValue(utm);
    }
  }, [query, value, consent]);

  return <></>;
};

// Without a saved source, the one in the current address, for this visit only
export const useUtmUrl = () => {
  const [value] = useLocalStorage({ key: 'utm', defaultValue: '' });
  const query = useSearchParams();
  return value || getUtmFromQuery(query);
};
export default UtmSaver;
