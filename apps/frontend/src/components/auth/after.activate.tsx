'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useCookie from 'react-use-cookie';
export const AfterActivate = () => {
  const fetch = useFetch();
  const params = useParams();
  const [showLoader, setShowLoader] = useState(true);
  const [reason, setReason] = useState<string>();
  const run = useRef(false);
  const t = useT();
  const [datafast_visitor_id] = useCookie('datafast_visitor_id');

  useEffect(() => {
    if (!run.current) {
      run.current = true;
      loadCode();
    }
  }, []);
  const loadCode = useCallback(async () => {
    if (params.code) {
      const response = await fetch(`/auth/activate`, {
        method: 'POST',
        body: JSON.stringify({
          code: params.code,
          datafast_visitor_id,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (response.headers.get('onboarding')) {
        return;
      }
      const { can, reason } = await response.json();
      if (!can) {
        setReason(reason);
        setShowLoader(false);
      }
    }
  }, []);
  return (
    <>
      {showLoader ? (
        <LoadingComponent />
      ) : (
        <>
          {reason === 'activated' ? (
            t('user_already_activated', 'This user is already activated.')
          ) : reason === 'expired' ? (
            <>
              {t(
                'activation_link_expired',
                'This activation link has expired.'
              )}{' '}
              <Link href="/auth/activate" className="underline">
                {t('resend_activation_email', 'Resend Activation Email')}
              </Link>
            </>
          ) : (
            <>
              {t(
                'activation_link_invalid',
                'This activation link is not valid.'
              )}{' '}
              <Link href="/auth/activate" className="underline">
                {t('resend_activation_email', 'Resend Activation Email')}
              </Link>
            </>
          )}
          <br />
          <Link href="/auth/login" className="underline">
            {t(
              'click_here_to_go_back_to_login',
              'Click here to go back to login'
            )}
          </Link>
        </>
      )}
    </>
  );
};
