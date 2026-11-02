'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dynamic from 'next/dynamic';
import AuthenticationComponent from '@gitroom/frontend/components/settings/authentication.component';
import EmailNotificationsComponent from '@gitroom/frontend/components/settings/email-notifications.component';
import ShortlinkPreferenceComponent from '@gitroom/frontend/components/settings/shortlink-preference.component';
import DeleteAccountComponent from '@gitroom/frontend/components/settings/delete-account.component';
import { CookieSettingsButton } from '@gitroom/frontend/components/layout/cookie.consent';

const MetricComponent = dynamic(
  () => import('@gitroom/frontend/components/settings/metric.component'),
  {
    ssr: false,
  }
);

export const GlobalSettings = () => {
  const t = useT();
  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('global_settings', 'Global Settings')}</h3>
      <AuthenticationComponent />
      <nav aria-label={t('legal_information', 'Legal information')} className="flex flex-wrap gap-[16px] text-[14px] mb-[16px]">
        <a className="underline hover:text-textItemFocused" href="/legal/privacy/" target="_blank" rel="noopener noreferrer">
          {t('privacy_policy', 'Privacy Policy')}
          <span className="sr-only"> ({t('opens_in_new_tab', 'opens in a new tab')})</span>
        </a>
        <a className="underline hover:text-textItemFocused" href="/legal/terms/" target="_blank" rel="noopener noreferrer">
          {t('terms_of_service', 'Terms of Service')}
          <span className="sr-only"> ({t('opens_in_new_tab', 'opens in a new tab')})</span>
        </a>
        <CookieSettingsButton className="underline hover:text-textItemFocused" />
      </nav>
      <MetricComponent />
      <EmailNotificationsComponent />
      <ShortlinkPreferenceComponent />
      <DeleteAccountComponent />
    </div>
  );
};
