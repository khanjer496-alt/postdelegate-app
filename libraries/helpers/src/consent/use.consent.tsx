'use client';

import { useEffect, useState } from 'react';
import {
  CONSENT_CHANGE_EVENT,
  ConsentChoices,
  readConsent,
} from '@gitroom/helpers/consent/consent.cookie';

// The saved cookie choices, undefined until the visitor chose (and on the
// server). Follows changes made in the cookie banner without a reload.
export const useConsent = () => {
  const [consent, setConsent] = useState<ConsentChoices | undefined>();

  useEffect(() => {
    const read = () => setConsent(readConsent(document.cookie));
    read();
    window.addEventListener(CONSENT_CHANGE_EVENT, read);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, read);
  }, []);

  return consent;
};
