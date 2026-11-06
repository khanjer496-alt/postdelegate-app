'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Slider } from '@gitroom/react/form/slider';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

interface EmailNotifications {
  sendSuccessEmails: boolean;
  sendFailureEmails: boolean;
  sendStreakEmails: boolean;
  sendOnboardingEmails: boolean;
}

export const useEmailNotifications = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch('/user/email-notifications')).json();
  }, []);

  return useSWR<EmailNotifications>('email-notifications', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

// the Monday summary of the current workspace, kept per workspace
export const useWeeklySummary = () => {
  const fetch = useFetch();
  const user = useUser();

  const load = useCallback(async () => {
    return (await fetch('/weekly-summary')).json();
  }, []);

  return useSWR<{ enabled: boolean }>(`weekly-summary-${user?.orgId}`, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};

const WeeklySummaryRow = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate } = useWeeklySummary();

  const change = useCallback(
    async (value: 'on' | 'off') => {
      const enabled = value === 'on';
      await mutate({ enabled }, { revalidate: false });
      const response = await fetch('/weekly-summary', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        await mutate();
        toaster.show(
          t('settings_update_failed', 'Could not update the setting'),
          'warning'
        );
        return;
      }
      toaster.show(t('settings_updated', 'Settings updated'), 'success');
    },
    [mutate]
  );

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <div className="text-[14px]">
          {t('weekly_summary_email', 'Weekly summary')}
        </div>
        <div className="text-[12px] text-newTextColor/70">
          {t(
            'weekly_summary_email_description',
            "A Monday morning email with last week's results and this week's schedule for this workspace."
          )}
        </div>
      </div>
      <Slider
        value={data?.enabled ? 'on' : 'off'}
        onChange={change}
        fill={true}
      />
    </div>
  );
};

const EmailNotificationsComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, isLoading } = useEmailNotifications();

  const [localSettings, setLocalSettings] = useState<EmailNotifications>({
    sendSuccessEmails: true,
    sendFailureEmails: true,
    sendStreakEmails: true,
    sendOnboardingEmails: true,
  });

  // Keep a ref to always have the latest state
  const settingsRef = useRef(localSettings);
  settingsRef.current = localSettings;

  // Sync local state with fetched data
  useEffect(() => {
    if (data) {
      setLocalSettings(data);
    }
  }, [data]);

  const updateSetting = useCallback(
    async (key: keyof EmailNotifications, value: boolean) => {
      // Use ref to get the latest state
      const currentSettings = settingsRef.current;
      const newData = {
        ...currentSettings,
        [key]: value,
      };

      // Update local state immediately
      setLocalSettings(newData);

      await fetch('/user/email-notifications', {
        method: 'POST',
        body: JSON.stringify(newData),
      });

      toaster.show(t('settings_updated', 'Settings updated'), 'success');
    },
    []
  );

  const handleSuccessEmailsChange = useCallback(
    (value: 'on' | 'off') => {
      updateSetting('sendSuccessEmails', value === 'on');
    },
    [updateSetting]
  );

  const handleFailureEmailsChange = useCallback(
    (value: 'on' | 'off') => {
      updateSetting('sendFailureEmails', value === 'on');
    },
    [updateSetting]
  );

  const handleStreakEmailsChange = useCallback(
    (value: 'on' | 'off') => {
      updateSetting('sendStreakEmails', value === 'on');
    },
    [updateSetting]
  );

  const handleOnboardingEmailsChange = useCallback(
    (value: 'on' | 'off') => {
      updateSetting('sendOnboardingEmails', value === 'on');
    },
    [updateSetting]
  );

  if (isLoading) {
    return (
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px]">
        <div className="animate-pulse">
          {t('loading', 'Loading...')}
        </div>
      </div>
    );
  }

  return (
    <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[24px]">
      <div className="mt-[4px]">
        {t('email_notifications', 'Email Notifications')}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t('success_emails', 'Success Emails')}
          </div>
          <div className="text-[12px] text-customColor18">
            {t(
              'success_emails_description',
              'Receive email notifications when posts are published successfully'
            )}
          </div>
        </div>
        <Slider
          value={localSettings.sendSuccessEmails ? 'on' : 'off'}
          onChange={handleSuccessEmailsChange}
          fill={true}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t('failure_emails', 'Failure Emails')}
          </div>
          <div className="text-[12px] text-customColor18">
            {t(
              'failure_emails_description',
              'Receive email notifications when posts fail to publish'
            )}
          </div>
        </div>
        <Slider
          value={localSettings.sendFailureEmails ? 'on' : 'off'}
          onChange={handleFailureEmailsChange}
          fill={true}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t('streak_emails', 'Streak Reminder Emails')}
          </div>
          <div className="text-[12px] text-customColor18">
            {t(
              'streak_emails_description',
              'Receive email reminders when your posting streak is about to end'
            )}
          </div>
        </div>
        <Slider
          value={localSettings.sendStreakEmails ? 'on' : 'off'}
          onChange={handleStreakEmailsChange}
          fill={true}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t('onboarding_emails', 'Getting started emails')}
          </div>
          <div className="text-[12px] text-newTextColor/70">
            {t(
              'onboarding_emails_description',
              'A few short tips during your free trial, such as connecting a channel and drafting posts with AI.'
            )}
          </div>
        </div>
        <Slider
          value={localSettings.sendOnboardingEmails ? 'on' : 'off'}
          onChange={handleOnboardingEmailsChange}
          fill={true}
        />
      </div>
      <WeeklySummaryRow />
    </div>
  );
};

export default EmailNotificationsComponent;

