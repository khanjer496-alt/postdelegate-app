'use client';

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HttpStatusCode } from 'axios';
import { useRouter } from 'next/navigation';
import { Redirect } from '@gitroom/frontend/components/layout/redirect';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { continueProviderList } from '@gitroom/frontend/components/new-launch/providers/continue-provider/list';
import { IntegrationContext } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { sameOriginUrl } from '@gitroom/frontend/app/(app)/auth/return.url.component';
import { errorMessage } from '@gitroom/frontend/components/launches/import/import.posts.modal';
import {
  clearExtensionCode,
  readExtensionCode,
} from '@gitroom/frontend/components/launches/helpers/extension.code';

interface TwoStepState {
  integrationId: string;
  onboarding: boolean;
  pages: any[];
  returnURL?: string;
  // a confirmed shared link: the page is saved by its state, never by the
  // workspace this browser happens to be signed in to
  sharedLink: boolean;
}

// The whole screen is one value, so every path ends in something visible
type ConnectState =
  | { status: 'loading' }
  // a shared connect link: the person says which workspace gets the account
  | {
      status: 'confirm';
      workspaceName: string;
      providerName: string;
      createdBy?: string;
      // signed in to PostDelegate, but not a member of the link's workspace
      outsideWorkspace: boolean;
    }
  | { status: 'picking'; step: TwoStepState; saveError?: string }
  | { status: 'saving'; step: TwoStepState }
  | { status: 'error'; message?: string }
  | { status: 'done'; message: string };

// The return address is stored with the connect request: an address on this
// app, a partner app (enterprise connect) or the mobile app's own link. Never
// a javascript: or data: URL.
const EXTERNAL_RETURN_PROTOCOLS = ['https:', 'http:', 'postiz:'];
const safeReturnUrl = (url?: string) => {
  if (!url || typeof window === 'undefined') {
    return null;
  }
  const sameOrigin = sameOriginUrl(url);
  if (sameOrigin) {
    return { url: new URL(sameOrigin), external: false };
  }
  try {
    const parsed = new URL(url);
    return EXTERNAL_RETURN_PROTOCOLS.includes(parsed.protocol)
      ? { url: parsed, external: true }
      : null;
  } catch {
    return null;
  }
};

export const ContinueIntegration: FC<{
  provider: string;
  searchParams: any;
  logged: boolean;
}> = (props) => {
  const { provider, searchParams, logged } = props;
  const { push } = useRouter();
  const t = useT();
  const fetch = useFetch();
  const { extensionId, backendUrl } = useVariables();
  const [state, setState] = useState<ConnectState>({ status: 'loading' });
  // the OAuth code can be exchanged only once, even if the effect runs twice
  const started = useRef(false);

  // Redirects to the return address, or to the calendar when logged in,
  // otherwise shows the result on this page. A shared link's channel went to
  // the workspace of the link, not necessarily the one signed in here, so it
  // shows the result too
  const navigateOrShow = useCallback(
    (
      params: Record<string, string>,
      returnURL: string | undefined,
      message: string,
      kind: 'success' | 'error',
      sharedLink = false
    ) => {
      const target = safeReturnUrl(returnURL);
      if (target) {
        Object.entries(params).forEach(([key, value]) =>
          target.url.searchParams.set(key, value)
        );
        if (target.external) {
          window.location.href = target.url.toString();
        } else {
          push(target.url.pathname + target.url.search + target.url.hash);
        }
        return;
      }
      if (logged && !sharedLink) {
        push(`/launches?${new URLSearchParams(params).toString()}`);
        return;
      }
      setState(
        kind === 'success'
          ? { status: 'done', message }
          : { status: 'error', message }
      );
    },
    [logged, push]
  );
  const modifiedParams = useMemo(() => {
    if (provider === 'mewe') {
      return {
        state: searchParams.state || '',
        code: searchParams.loginRequestToken || '',
        refresh: searchParams.refresh || '',
      };
    }
    if (provider === 'x') {
      return {
        state: searchParams.oauth_token || '',
        code: searchParams.oauth_verifier || '',
        refresh: searchParams.refresh || '',
      };
    }

    if (provider === 'tiktok-business') {
      // The TikTok Business API redirects back with `auth_code` instead of `code`
      return {
        state: searchParams.state || '',
        code: searchParams.auth_code || searchParams.code || '',
        refresh: searchParams.refresh || '',
      };
    }

    if (provider === 'vk') {
      return {
        ...searchParams,
        state: searchParams.state || '',
        code: searchParams.code + '&&&&' + searchParams.device_id,
      };
    }

    if (provider === 'mewe') {
      const hash =
        typeof window !== 'undefined' ? window.location.hash.substring(1) : '';
      const hashParams = new URLSearchParams(hash);
      return {
        state: hashParams.get('state') || searchParams.state || '',
        code: hashParams.get('loginRequestToken') || '',
        refresh: searchParams.refresh || '',
      };
    }

    return searchParams;
  }, []);

  const Provider = useMemo(() => {
    return (
      continueProviderList[provider as keyof typeof continueProviderList] ||
      null
    );
  }, [provider]);

  const providerDisplayName = useMemo(() => {
    const names: Record<string, string> = {
      facebook: 'Facebook',
      instagram: 'Instagram',
      'linkedin-page': 'LinkedIn',
      youtube: 'YouTube',
      gmb: 'Google Business',
      tumblr: 'Tumblr',
      'tiktok-business': 'TikTok Business',
    };
    return names[provider] || provider;
  }, [provider]);

  const connect = useCallback(async (confirmed = false) => {
    const timezone = String(newDayjs().utcOffset());
    const extensionCode = readExtensionCode(modifiedParams.state);
    const body = JSON.stringify({
      ...modifiedParams,
      ...(extensionCode ? { code: extensionCode } : {}),
      timezone,
      ...(confirmed ? { confirmed: true } : {}),
    });

    // Try public endpoint first (handles both public and fallback scenarios)
    let data = await fetch(`/integrations/social-connect/${provider}`, {
      method: 'POST',
      body,
    });

    // If public endpoint fails with specific errors, try authenticated endpoint
    if (data.status === HttpStatusCode.BadRequest) {
      const errorData = await data
        .clone()
        .json()
        .catch(() => ({}));
      // "Invalid connection type" means this wasn't started as a public flow
      if (
        errorData.message?.includes('Invalid connection type') ||
        errorData.message?.includes('Invalid or expired state')
      ) {
        data = await fetch(`/integrations/social-connect/${provider}`, {
          method: 'POST',
          body,
        });
      }
    }

    // A shared link (an invite, an API or partner link, the mobile app) asks
    // first; the code was not used yet, the confirmation posts it again
    if (data.ok) {
      const pending = await data
        .clone()
        .json()
        .catch(() => ({}));
      if (pending?.needsConfirmation) {
        setState({
          status: 'confirm',
          workspaceName: String(pending.workspaceName || ''),
          providerName: String(pending.providerName || providerDisplayName),
          createdBy:
            typeof pending.createdBy === 'string' && pending.createdBy
              ? pending.createdBy
              : undefined,
          outsideWorkspace: !!pending.signedInOutsideWorkspace,
        });
        return;
      }
    }

    // the backend answered: the cookies were used (or refused), drop them
    clearExtensionCode(modifiedParams.state);

    if (data.status === HttpStatusCode.PreconditionFailed) {
      const { returnURL } = await data.json().catch(() => ({}));
      navigateOrShow(
        { precondition: 'true' },
        returnURL,
        'Precondition failed',
        'error'
      );
      return;
    }

    if (data.status === HttpStatusCode.NotAcceptable) {
      const { msg, returnURL } = await data.json().catch(() => ({}));
      const message =
        typeof msg === 'string' && msg
          ? msg
          : t('could_not_add_provider', 'Could not add provider');
      navigateOrShow(
        { msg: message, msgType: 'error' },
        returnURL,
        message,
        'error'
      );
      return;
    }

    if (!data.ok) {
      setState({
        status: 'error',
        message: (await errorMessage(data, '')) || undefined,
      });
      return;
    }

    const {
      inBetweenSteps,
      id,
      onboarding: resOnboarding,
      pages,
      returnURL,
      extensionToken,
    } = await data.json();
    const onboarding = resOnboarding || searchParams.onboarding === 'true';

    // Store refresh token in extension for background cookie refresh
    if (
      extensionToken &&
      extensionId &&
      typeof chrome !== 'undefined' &&
      chrome?.runtime?.sendMessage
    ) {
      try {
        chrome.runtime.sendMessage(
          extensionId,
          {
            type: 'STORE_REFRESH_TOKEN',
            provider,
            integrationId: id,
            jwt: extensionToken,
            backendUrl,
          },
          () => {
            if (chrome.runtime.lastError) {
              return;
            }
          }
        );
      } catch {
        // Silently ignore — extension may not be available
      }
    }

    // If it's a two-step provider, show the selection UI inline
    if (inBetweenSteps && !searchParams.refresh) {
      if (!Provider) {
        setState({ status: 'error' });
        return;
      }
      setState({
        status: 'picking',
        step: {
          integrationId: id,
          onboarding,
          pages: pages || [],
          returnURL,
          sharedLink: confirmed,
        },
      });
      return;
    }

    navigateOrShow(
      {
        added: provider,
        msg: 'Channel Updated',
        msgType: 'success',
        ...(onboarding ? { onboarding: 'true' } : {}),
      },
      returnURL,
      'Channel Updated',
      'success',
      confirmed
    );
  }, [modifiedParams, provider, Provider, navigateOrShow, providerDisplayName]);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    connect().catch(() => {
      setState({ status: 'error' });
    });
  }, []);

  const onSave = useCallback(
    async (data: any) => {
      if (state.status !== 'picking') return;
      const { step } = state;

      setState({ status: 'saving', step });

      try {
        // Use public or authenticated endpoint based on the flow
        const endpoint =
          logged && !step.sharedLink
            ? `/integrations/provider/${step.integrationId}/connect`
            : `/integrations/public/provider/${step.integrationId}/connect`;

        // The OAuth code was already exchanged; saving the page only needs the
        // state (which finds the organization of a public flow), so a retry
        // never sends the one-time code again
        const response = await fetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({ state: modifiedParams.state, ...data }),
        });

        if (!response.ok) {
          setState({
            status: 'picking',
            step,
            saveError:
              await errorMessage(
                response,
                t('error_occurred', 'An error occurred. Please try again.')
              ),
          });
          return;
        }

        navigateOrShow(
          {
            added: provider,
            msg: 'Channel Added',
            msgType: 'success',
            ...(step.onboarding ? { onboarding: 'true' } : {}),
          },
          step.returnURL,
          'Channel Added',
          'success',
          step.sharedLink
        );
      } catch (e) {
        setState({
          status: 'picking',
          step,
          saveError: t('error_occurred', 'An error occurred. Please try again.'),
        });
      }
    },
    [state, fetch, logged, modifiedParams, provider, navigateOrShow, t]
  );

  const confirmLink = useCallback(() => {
    setState({ status: 'loading' });
    connect(true).catch(() => {
      setState({ status: 'error' });
    });
  }, [connect]);

  // nothing was exchanged; the link is dropped so the code the platform sent
  // can never be completed later
  const cancelLink = useCallback(async () => {
    await fetch(`/integrations/social-connect/${provider}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ state: modifiedParams.state }),
    }).catch(() => undefined);
    setState({
      status: 'error',
      message: t(
        'connect_link_cancelled',
        'The connection was cancelled and nothing was added. You can close this window.'
      ),
    });
  }, [fetch, provider, modifiedParams, t]);

  // A shared link names the workspace before anything is connected
  if (state.status === 'confirm') {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        {/* Background gradient decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#FC69FF] rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 w-full max-w-[480px] mx-auto px-[20px]">
          <div className="bg-[#11141C] ring-1 ring-[#262B37] rounded-[16px] p-[32px] flex flex-col gap-[24px]">
            <div className="flex flex-col gap-[8px] text-center">
              <h1 className="text-[24px] font-semibold">
                {t('confirm_connect_title', 'Confirm the connection')}
              </h1>
              <p className="text-[14px] text-gray-400">
                {t(
                  'confirm_connect_description',
                  "Connect your {{provider}} account to the PostDelegate workspace '{{workspace}}'? Only continue if you trust whoever sent you this link.",
                  {
                    provider: state.providerName,
                    workspace: state.workspaceName,
                    // React escapes the text, i18next must not do it twice
                    interpolation: { escapeValue: false },
                  }
                )}
              </p>
              {!!state.createdBy && (
                <p className="text-[14px] text-gray-400">
                  {t('confirm_connect_created_by', 'Link created by {{name}}', {
                    name: state.createdBy,
                    interpolation: { escapeValue: false },
                  })}
                </p>
              )}
            </div>
            {state.outsideWorkspace && (
              <div
                role="alert"
                className="rounded-[8px] bg-red-500/10 ring-1 ring-red-500/40 text-red-400 text-[14px] px-[16px] py-[12px] text-center"
              >
                {t(
                  'confirm_connect_outside_workspace',
                  "You're signed in to PostDelegate, but this link connects your account to a workspace you're not part of."
                )}
              </div>
            )}
            <div className="flex gap-[12px]">
              <Button
                secondary
                className="flex-1 rounded-[8px]"
                onClick={cancelLink}
              >
                {t('cancel', 'Cancel')}
              </Button>
              <Button className="flex-1 rounded-[8px]" onClick={confirmLink}>
                {t('confirm_connect', 'Connect')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success state for non-logged users without returnURL
  if (state.status === 'done') {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        {/* Background gradient decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#FC69FF] rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 text-center">
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-green-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-green-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[28px] font-semibold mb-[12px]">
            {t('channel_connected', 'Channel Connected!')}
          </div>
          <div className="text-[16px] text-gray-400 max-w-[400px]">
            {state.message ||
              t(
                'channel_connected_description',
                `Your ${providerDisplayName} channel has been successfully connected. You can close this window now.`
              )}
          </div>
        </div>
      </div>
    );
  }

  // Show the two-step selection UI
  if ((state.status === 'picking' || state.status === 'saving') && Provider) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        {/* Background gradient decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#FC69FF] rounded-full blur-[120px]" />
        </div>

        {/* Content */}
        <div className="relative z-10 w-full max-w-[550px] mx-auto px-[20px]">
          <div className="bg-[#11141C] ring-1 ring-[#262B37] rounded-[16px] p-[32px] flex flex-col gap-[24px]">
            <div className="flex flex-col gap-[8px] text-center">
              <h1 className="text-[24px] font-semibold">
                {t('configure_your_channel', 'Configure Your Channel')}
              </h1>
              <p className="text-[14px] text-gray-400">
                {t(
                  'select_the_page_or_account',
                  `Select the ${providerDisplayName} page or account you want to connect.`
                )}
              </p>
            </div>

            {state.status === 'picking' && !!state.saveError && (
              <div
                role="alert"
                className="rounded-[8px] bg-red-500/10 ring-1 ring-red-500/40 text-red-400 text-[14px] px-[16px] py-[12px] text-center"
              >
                {state.saveError}
              </div>
            )}

            <IntegrationContext.Provider
              value={{
                date: newDayjs(),
                value: [],
                allIntegrations: [],
                integration: {
                  editor: 'normal',
                  additionalSettings: '',
                  display: '',
                  time: [{ time: 0 }],
                  id: state.step.integrationId,
                  type: '',
                  name: '',
                  picture: '',
                  inBetweenSteps: true,
                  changeNickName: false,
                  changeProfilePicture: false,
                  identifier: provider,
                },
              }}
            >
              <Provider
                onSave={onSave}
                existingId={[]}
                initialData={state.step.pages}
                isSaving={state.status === 'saving'}
              />
            </IntegrationContext.Provider>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        {/* Background gradient decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#FC69FF] rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 text-center">
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-red-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-red-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[28px] font-semibold mb-[12px]">
            {t('could_not_add_provider', 'Could not add provider')}
          </div>
          <div className="text-[16px] text-gray-400 max-w-[400px]">
            {state.message ||
              (logged
                ? t(
                    'you_are_being_redirected_back',
                    'You are being redirected back'
                  )
                : t('error_occurred', 'An error occurred. Please try again.'))}
          </div>
          {logged && <Redirect url="/launches" delay={3000} />}
        </div>
      </div>
    );
  }

  // Loading state
  return (
    <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
      {/* Background gradient decoration */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
        <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#FC69FF] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 text-center">
        <div className="text-[28px] font-semibold mb-[12px]">
          {t('adding_channel', 'Adding Channel')}
        </div>
        <div className="text-[16px] text-gray-400">
          {t('please_wait', 'Please wait while we connect your account...')}
        </div>
        {/* Loading spinner */}
        <div className="mt-[32px] flex justify-center">
          <div className="w-[48px] h-[48px] border-[3px] border-btnPrimary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    </div>
  );
};
