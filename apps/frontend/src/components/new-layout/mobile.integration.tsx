'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AddProviderComponent } from '@gitroom/frontend/components/launches/add.provider.component';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const MobileIntegration: FC = () => {
  const [integrations, setIntegrations] = useState(null as any);
  const [signedOut, setSignedOut] = useState(false);
  const fetch = useFetch();
  const t = useT();

  const loadIntegrations = useCallback(async () => {
    // the list belongs to the signed-in workspace, a signed-out visit gets
    // an error body instead of the providers
    const response = await fetch('/integrations/available');
    if (!response.ok) {
      setSignedOut(true);
      return;
    }
    setIntegrations(await response.json());
  }, []);

  useEffect(() => {
    loadIntegrations();
  }, []);

  if (signedOut) {
    return (
      <div className="flex justify-center p-[20px] text-textColor">
        <Link href="/auth/login" className="underline cursor-pointer">
          {t('sign_in', 'Sign In')}
        </Link>
      </div>
    );
  }

  if (!integrations) {
    return null;
  }

  return (
    <AddProviderComponent
      isMobile={true}
      invite={false}
      update={() => {}}
      {...integrations}
    />
  );
};
