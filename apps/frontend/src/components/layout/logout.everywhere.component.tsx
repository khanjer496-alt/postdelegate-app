'use client';

import React, { FC, useCallback } from 'react';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { setCookie } from '@gitroom/frontend/components/layout/layout.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Signs out every device, not just this browser. The session cookie lives for a
// year and the only other way to invalidate one is changing the password, which
// is not what someone reaches for when a laptop goes missing.
export const LogoutEverywhereComponent: FC = () => {
  const fetch = useFetch();
  const t = useT();

  const logoutEverywhere = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'are_you_sure_sign_out_all_devices',
          'This signs you out on every device, including this one. Continue?'
        ),
        t('yes_sign_out_everywhere', 'Yes, sign out everywhere')
      ))
    ) {
      return;
    }

    await fetch('/user/logout-everywhere', {
      method: 'POST',
    });
    // the cookie is cleared by the response too; this covers the unsecured
    // local setup where the browser keeps it
    setCookie('auth', '', -10);
    window.location.href = '/';
  }, [fetch, t]);

  return (
    <div className="cursor-pointer" onClick={logoutEverywhere}>
      <span className="text-red-400">
        {t('sign_out_all_devices', 'Sign out of all devices')}
      </span>
    </div>
  );
};
