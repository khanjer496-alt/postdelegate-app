'use client';

import { ReactNode, useCallback } from 'react';
import { SWRConfig } from 'swr';
import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';
import { HandledResponseError } from '@gitroom/helpers/utils/custom.fetch.func';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { areYouSure } from '@gitroom/frontend/components/layout/new-modal';
import { useReturnUrl } from '@gitroom/frontend/app/(app)/auth/return.url.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export default function LayoutContext(params: { children: ReactNode }) {
  if (params?.children) {
    // eslint-disable-next-line react/no-children-prop
    return <LayoutContextInner children={params.children} />;
  }
  return <></>;
}
// a request whose dialog already answered it (trial, billing) is not retried,
// a retry would only open the same dialog again
const swrConfig = {
  onErrorRetry: (
    ...args: Parameters<typeof SWRConfig.defaultValue.onErrorRetry>
  ) => {
    if (args[0] instanceof HandledResponseError) {
      return;
    }
    SWRConfig.defaultValue.onErrorRetry(...args);
  },
};
// endpoints whose 406 is their own error, shown by the caller, not the trial
// wall; the trial 406 has no marker in its body to tell them apart
const OWN_NOT_ACCEPTABLE = ['/integrations/social-connect/'];
export function setCookie(cname: string, cvalue: string, exdays: number) {
  if (typeof document === 'undefined') {
    return;
  }
  const d = new Date();
  d.setTime(d.getTime() + exdays * 24 * 60 * 60 * 1000);
  const expires = 'expires=' + d.toUTCString();
  document.cookie = cname + '=' + cvalue + ';' + expires + ';path=/';
}
function LayoutContextInner(params: { children: ReactNode }) {
  const returnUrl = useReturnUrl();
  const { backendUrl, isGeneral, isSecured } = useVariables();
  const t = useT();
  const afterRequest = useCallback(
    async (url: string, options: RequestInit, response: Response) => {
      if (
        typeof window !== 'undefined' &&
        (window.location.href.includes('/p/') ||
          // client approval links are opened signed out, never redirect them
          window.location.pathname.startsWith('/approve/') ||
          window.location.pathname.startsWith('/provider/'))
      ) {
        return true;
      }
      const headerAuth =
        response?.headers?.get('auth') || response?.headers?.get('Auth');
      const showOrg =
        response?.headers?.get('showorg') || response?.headers?.get('Showorg');
      const impersonate =
        response?.headers?.get('impersonate') ||
        response?.headers?.get('Impersonate');
      const logout =
        response?.headers?.get('logout') || response?.headers?.get('Logout');
      if (headerAuth) {
        setCookie('auth', headerAuth, 365);
      }
      if (showOrg) {
        setCookie('showorg', showOrg, 365);
      }
      if (impersonate) {
        setCookie('impersonate', impersonate, 365);
      }
      if (logout && !isSecured) {
        setCookie('auth', '', -10);
        setCookie('showorg', '', -10);
        setCookie('impersonate', '', -10);
        window.location.href = '/';
        return true;
      }
      const reloadOrOnboarding =
        response?.headers?.get('reload') ||
        response?.headers?.get('onboarding');
      if (reloadOrOnboarding) {
        const getAndClear = returnUrl.getAndClear();
        if (getAndClear) {
          window.location.href = getAndClear;
          return true;
        }
      }
      if (response?.headers?.get('onboarding')) {
        window.location.href = isGeneral
          ? '/launches?onboarding=true'
          : '/analytics?onboarding=true';
        return true;
      }

      if (response?.headers?.get('reload')) {
        window.location.reload();
        return true;
      }

      if (response.status === 401 || response?.headers?.get('logout')) {
        if (!isSecured) {
          setCookie('auth', '', -10);
          setCookie('showorg', '', -10);
          setCookie('impersonate', '', -10);
        }
        window.location.href = '/';
      }
      if (
        response.status === 406 &&
        !OWN_NOT_ACCEPTABLE.some((path) => url.startsWith(path))
      ) {
        if (
          await deleteDialog(
            "This feature is not available during the trial. You can end the trial now: your plan's first payment is charged today instead of at the end of the trial.",
            'End trial and pay now',
            'Trial',

          )
        ) {
          window.open('/billing?finishTrial=true', '_blank');
          return false;
        }
        return false;
      }

      // an admin-only action a member tried, the fix is asking an admin
      if (response.status === 403) {
        const body = await response
          .clone()
          .json()
          .catch(() => ({}));
        if (body?.section === 'admin') {
          await areYouSure({
            title: t('action_required', 'Action required'),
            description: body.message,
            approveLabel: t('ok', 'OK'),
            onlyApprove: true,
          });
        }
        return true;
      }

      if (response.status === 402) {
        // the backend sends where the fix is: billing for a plan limit,
        // Settings for a missing AI key, or no link when only an admin can fix it
        const body = await response
          .clone()
          .json()
          .catch(() => ({ url: '/billing' }));

        if (!body.url) {
          await areYouSure({
            title: t('action_required', 'Action required'),
            description: body.message,
            approveLabel: t('ok', 'OK'),
            onlyApprove: true,
          });
          return true;
        }

        const { pathname, search } = new URL(body.url, window.location.origin);
        const billing = pathname === '/billing';
        // a full plan that sells extra channels adds them instead of upgrading
        const extraChannels = new URLSearchParams(search).has('extraChannels');
        if (
          await deleteDialog(
            body.message,
            extraChannels
              ? t('add_extra_channels', 'Add extra channels')
              : billing
              ? 'Move to billing'
              : t('open_settings', 'Open settings'),
            extraChannels
              ? t('channel_limit_reached', 'Channel limit reached')
              : billing
              ? 'Payment Required'
              : t('action_required', 'Action required')
          )
        ) {
          window.open(pathname + search, '_blank');
          return false;
        }
        return true;
      }
      return true;
    },
    [t, returnUrl, isGeneral, isSecured]
  );
  return (
    <SWRConfig value={swrConfig}>
      <FetchWrapperComponent baseUrl={backendUrl} afterRequest={afterRequest}>
        {params?.children || <></>}
      </FetchWrapperComponent>
    </SWRConfig>
  );
}
