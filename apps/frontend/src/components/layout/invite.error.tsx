'use client';

import { FC, useEffect } from 'react';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';

// Why a team invite could not be accepted at sign in (the invite_error cookie
// the backend or the proxy leaves), told once
export const InviteError: FC = () => {
  const toaster = useToaster();
  const t = useT();

  useEffect(() => {
    const reason = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith('invite_error='))
      ?.split('=')[1];
    if (!reason) {
      return;
    }

    const domain = getCookieUrlFromDomain(window.location.href);
    document.cookie = `invite_error=; path=/; max-age=0; domain=${domain}`;
    document.cookie = 'invite_error=; path=/; max-age=0';

    const messages: Record<string, string> = {
      wrong_email: t(
        'invite_error_wrong_email',
        'This invite was sent to a different email. Sign in with the invited email to join the workspace.'
      ),
      already_used: t(
        'invite_error_already_used',
        'This invite was already used. Ask a workspace admin for a new one.'
      ),
      plan: t(
        'invite_error_plan',
        "The workspace's plan does not include team members right now. Ask a workspace admin to upgrade, then use the invite again."
      ),
    };
    toaster.show(
      messages[reason] ||
        t(
          'invite_error_generic',
          'We could not add you to the workspace. Ask a workspace admin for a new invite.'
        ),
      'warning'
    );
  }, []);

  return null;
};
