import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { hasConsent } from '@gitroom/helpers/consent/consent.cookie';
export const useTrack = () => {
  const user = useUser();
  const fetch = useFetch();
  const { facebookPixel } = useVariables();
  return useCallback(
    async (track: TrackEnum, additional?: Record<string, any>) => {
      // the pixel events, sent here and through the backend, wait for the
      // analytics choice in the cookie banner
      if (!facebookPixel || !hasConsent('analytics')) {
        return;
      }
      try {
        const { track: uq } = await (
          await fetch(user ? `/user/t` : `/public/t`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tt: track,
              ...(additional
                ? {
                    additional,
                  }
                : {}),
            }),
          })
        ).json();
        if (window.fbq) {
          // @ts-ignore
          window.fbq('track', TrackEnum[track], additional, {
            eventID: uq,
          });
        }
      } catch (e) {
        console.log(e);
      }
    },
    [user]
  );
};
