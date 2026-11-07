'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';

export const OAuthAuthorize: FC<{ logged: boolean }> = ({ logged }) => {
  const searchParams = useSearchParams();
  const fetch = useFetch();
  const [appInfo, setAppInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');

  const clientId = searchParams.get('client_id');
  const responseType = searchParams.get('response_type');
  const state = searchParams.get('state');
  const redirectUri = searchParams.get('redirect_uri');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method');
  const resource = searchParams.get('resource');

  useEffect(() => {
    if (!clientId || !responseType) {
      setError('Missing required parameters (client_id, response_type)');
      setLoading(false);
      return;
    }
    if (responseType !== 'code') {
      setError('Only response_type=code is supported');
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: responseType,
      ...(state ? { state } : {}),
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
      ...(codeChallengeMethod
        ? { code_challenge_method: codeChallengeMethod }
        : {}),
      ...(resource ? { resource } : {}),
    });

    fetch(`/oauth/authorize?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.statusCode && data.statusCode >= 400) {
          setError(data.message || 'Invalid OAuth request');
        } else {
          setAppInfo(data);
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to validate OAuth request');
        setLoading(false);
      });
  }, [
    clientId,
    responseType,
    state,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    resource,
  ]);

  const handleAction = useCallback(
    async (action: 'approve' | 'deny') => {
      setSubmitting(true);
      setActionError('');
      try {
        const response = await fetch('/oauth/authorize', {
          method: 'POST',
          body: JSON.stringify({
            client_id: clientId,
            state,
            action,
            ...(redirectUri ? { redirect_uri: redirectUri } : {}),
            ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
            ...(codeChallengeMethod
              ? { code_challenge_method: codeChallengeMethod }
              : {}),
          }),
        });
        const result = await response.json().catch(() => ({} as any));

        // the page stays on "submitting" only while it leaves for the app
        if (
          response.ok &&
          typeof result.redirect === 'string' &&
          result.redirect
        ) {
          window.location.href = result.redirect;
          return;
        }
        const message = Array.isArray(result?.message)
          ? result.message[0]
          : result?.message;
        setActionError(
          typeof message === 'string' && message
            ? message
            : 'Failed to process authorization, please try again'
        );
        setSubmitting(false);
      } catch {
        setActionError('Failed to process authorization, please try again');
        setSubmitting(false);
      }
    },
    [clientId, state, redirectUri, codeChallenge, codeChallengeMethod]
  );

  // Sign in (or sign up) and land back on this same request
  const signIn = useCallback(() => {
    window.location.href = `/auth/login?returnUrl=${encodeURIComponent(
      window.location.href
    )}`;
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#7357FF] rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#C8FF4D] rounded-full blur-[120px]" />
        </div>
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-[24px]">
            <Logo />
          </div>
          <div className="text-[16px] text-gray-400">
            Please wait...
          </div>
          <div className="mt-[32px] flex justify-center">
            <div className="w-[48px] h-[48px] border-[3px] border-[#7357FF] border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#7357FF] rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#C8FF4D] rounded-full blur-[120px]" />
        </div>
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-[24px]">
            <Logo />
          </div>
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
            Authorization Error
          </div>
          <div className="text-[16px] text-gray-400 max-w-[400px]">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!appInfo) {
    return null;
  }

  return (
    <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#7357FF] rounded-full blur-[120px]" />
        <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#C8FF4D] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-[500px] mx-auto px-[20px]">
        <div className="flex justify-center mb-[32px]">
          <Logo />
        </div>

        <div className="bg-[#11141C] ring-1 ring-[#262B37] rounded-[16px] p-[32px] flex flex-col gap-[24px]">
          <div className="flex flex-col items-center gap-[16px]">
            {appInfo.app.picture?.path ? (
              <img
                src={appInfo.app.picture.path}
                alt={appInfo.app.name}
                className="w-[64px] h-[64px] rounded-full object-cover"
              />
            ) : (
              <div className="w-[64px] h-[64px] rounded-full bg-[#2A2929] flex items-center justify-center text-[24px] text-gray-400">
                {appInfo.app.name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <h2 className="text-[24px] font-semibold text-center">
              {appInfo.app.name}
            </h2>
            {appInfo.app.description && (
              <div className="text-gray-400 text-center text-[14px]">
                {appInfo.app.description}
              </div>
            )}
          </div>

          <>
              {!!appInfo.app.redirectHost && (
                <div className="border-t border-[#2A2929] pt-[16px] text-[14px] text-gray-400">
                  After you decide, you will be sent to{' '}
                  <span className="text-white font-semibold break-all">
                    {appInfo.app.redirectHost}
                  </span>
                  .{' '}
                  {!!appInfo.app.dynamic &&
                    'This application registered itself and its name is not verified, only continue if you started this connection and recognize that address.'}
                </div>
              )}
              <div className="border-t border-[#2A2929] pt-[16px]">
                <div className="text-[14px] text-gray-400 mb-[12px]">
                  This application is requesting access to your PostDelegate
                  account. It will be able to:
                </div>
                <ul className="text-[14px] list-disc list-inside space-y-[4px]">
                  <li>Access your integrations and channels</li>
                  <li>Create and schedule posts on your behalf</li>
                  <li>Read your post analytics</li>
                </ul>
              </div>

              {!!actionError && (
                <div
                  role="alert"
                  className="rounded-[8px] bg-red-500/10 ring-1 ring-red-500/40 text-red-400 text-[14px] px-[16px] py-[12px]"
                >
                  {actionError}
                </div>
              )}

              {logged ? (
                <div className="flex gap-[12px]">
                  <button
                    onClick={() => handleAction('approve')}
                    disabled={submitting}
                    className="flex-1 bg-[#7357FF] hover:bg-[#6545ED] disabled:opacity-50 text-white rounded-[8px] py-[10px] px-[16px] text-[14px] font-semibold transition-colors"
                  >
                    Authorize
                  </button>
                  <button
                    onClick={() => handleAction('deny')}
                    disabled={submitting}
                    className="flex-1 bg-[#2A2929] hover:bg-[#3A3939] disabled:opacity-50 text-white rounded-[8px] py-[10px] px-[16px] text-[14px] font-semibold transition-colors"
                  >
                    Deny
                  </button>
                </div>
              ) : (
                <button
                  onClick={signIn}
                  className="bg-[#7357FF] hover:bg-[#6545ED] text-white rounded-[8px] py-[10px] px-[16px] text-[14px] font-semibold transition-colors"
                >
                  Sign in to PostDelegate
                </button>
              )}
          </>
        </div>
      </div>
    </div>
  );
};
