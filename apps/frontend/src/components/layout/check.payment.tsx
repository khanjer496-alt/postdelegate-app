import { FC, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Loading from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timer } from '@gitroom/helpers/utils/timer';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { isChannelLockedByPlan } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';
import type { ChannelFlags } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';
// how long the spinner waits for the payment to be confirmed
const CHECK_TIMEOUT_MS = 60000;

const toggleBlockingOverlay = (on: boolean) => {
  if (on) {
    document.querySelector('body')?.classList.add('overflow-hidden');
    Array.from(document.querySelectorAll('.blurMe') || []).map((p) =>
      p.classList.add('blur-xs', 'pointer-events-none')
    );
  } else {
    document.querySelector('body')?.classList.remove('overflow-hidden');
    Array.from(document.querySelectorAll('.blurMe') || []).map((p) =>
      p.classList.remove('blur-xs', 'pointer-events-none')
    );
  }
};

export const CheckPayment: FC<{
  check: string;
  mutate: () => void;
  children: ReactNode;
}> = (props) => {
  // the check the page was opened with: taking it off the address once the
  // payment is settled must not swap this for a fragment and remount the page
  const [check] = useState(props.check);
  if (!check) {
    return <>{props.children}</>;
  }
  return <CheckPaymentInner {...props} check={check} />;
};

export const CheckPaymentInner: FC<{
  check: string;
  mutate: () => void;
  children: ReactNode;
}> = (props) => {
  const [showLoader, setShowLoader] = useState(true);
  // settled (confirmed, refused or given up on): the param comes off the
  // address, so a reload or a shared link never checks or counts it again
  const [settled, setSettled] = useState(false);
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useDecisionModal();
  const t = useT();
  const router = useRouter();
  const fireEvents = useFireEvents();
  const mounted = useRef(true);
  const purchased = useRef(false);

  useEffect(() => {
    toggleBlockingOverlay(showLoader);
  }, [showLoader]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      toggleBlockingOverlay(false);
    };
  }, []);

  // after the page under it rendered with the param (ChannelsAfterPayment
  // reads it on mount), never before
  useEffect(() => {
    if (!settled) {
      return;
    }
    const url = new URL(window.location.href);
    if (!url.searchParams.has('check')) {
      return;
    }
    url.searchParams.delete('check');
    router.replace(url.pathname + url.search);
  }, [settled]);

  // the purchase event, once, for a paid plan only: a trial start lands here
  // too, and is not a purchase
  const trackPurchase = useCallback(async () => {
    if (purchased.current) {
      return;
    }
    purchased.current = true;
    try {
      const response = await fetch('/billing/renewal');
      const renewal = response.ok ? await response.json() : null;
      if (renewal && !renewal.trialing) {
        fireEvents('purchase');
      }
    } catch (err) {
      // analytics never block the page
    }
  }, [fireEvents]);

  const checkSubscription = useCallback(async (startedAt = Date.now()) => {
    if (!mounted.current) {
      return;
    }
    // a failed check (network, server error) is asked again, like a payment
    // still processing
    let status: unknown = 0;
    try {
      const response = await fetch('/billing/check/' + props.check);
      status = response.ok ? (await response.json())?.status ?? 0 : 0;
    } catch (err) {
      status = 0;
    }
    if (!mounted.current) {
      return;
    }
    if (status === 0) {
      if (Date.now() - startedAt >= CHECK_TIMEOUT_MS) {
        setShowLoader(false);
        const retry = await modal.open({
          title: t('still_confirming_payment', 'Still confirming your payment…'),
          description: t(
            'still_confirming_payment_description',
            'Your payment is taking longer than usual to confirm. Your plan updates on its own once it is confirmed, or you can check again now.'
          ),
          approveLabel: t('check_again', 'Check again'),
          cancelLabel: t('close', 'Close'),
        });
        if (retry && mounted.current) {
          setShowLoader(true);
          return checkSubscription();
        }
        setSettled(true);
        return;
      }
      await timer(1000);
      return checkSubscription(startedAt);
    }
    if (status === 1) {
      modal.open({
        title: 'Invalid Payment',
        onlyApprove: true,
        approveLabel: 'OK',
        description:
          'We could not validate your payment method, please try again',
      });
      setShowLoader(false);
      setSettled(true);
      return;
    }
    if (status === 2) {
      setShowLoader(false);
      setSettled(true);
      props.mutate();
      trackPurchase();
      return;
    }
    // an answer this page does not know: never leave the page blocked
    setShowLoader(false);
    setSettled(true);
    toaster.show(
      t(
        'payment_status_unknown',
        'We could not confirm your payment yet. Your plan updates on its own once it is confirmed.'
      ),
      'warning'
    );
  }, []);
  useEffect(() => {
    checkSubscription();
  }, []);
  if (showLoader) {
    return (
      <div className="fixed bg-black/40 w-full h-full flex justify-center items-center z-[400]">
        <div>
          <Loading type="spin" color="var(--new-btn-primary)" height={250} width={250} />
        </div>
      </div>
    );
  }
  return props.children;
};

export const ChannelsAfterPayment: FC<{
  integrations: ChannelFlags[];
  // reloads the channel list and answers it, the list rendered first can be
  // from before the payment turned channels back on
  reload: () => Promise<ChannelFlags[] | undefined>;
}> = ({ integrations, reload }) => {
  const searchParams = useSearchParams();
  // read once: CheckPayment takes the param off the address after this mounts
  const [check] = useState(() => searchParams.get('check'));
  const fetch = useFetch();
  const modal = useDecisionModal();
  const t = useT();
  const shown = useRef(false);

  useEffect(() => {
    if (!check || shown.current || !integrations?.length) {
      return;
    }
    shown.current = true;
    (async () => {
      let status: unknown;
      try {
        const response = await fetch('/billing/check/' + check);
        status = response.ok ? (await response.json())?.status : undefined;
      } catch (err) {
        status = undefined;
      }
      if (status !== 2) {
        return;
      }
      let channels = integrations;
      try {
        channels = (await reload()) || integrations;
      } catch (err) {
        // keep the list already shown
      }
      // only the channels the plan locked are the plan's business: one the
      // customer turned off stays off after a payment, and says so itself
      if (channels.some(isChannelLockedByPlan)) {
        modal.open({
          title: t('channels_still_locked', 'Some channels are still locked'),
          onlyApprove: true,
          approveLabel: t('ok', 'OK'),
          description: t(
            'channels_still_locked_description',
            "Your plan doesn't have room for all of your connected channels, so some stay locked. Enable the ones you want from each channel's menu, up to your plan's limit, or upgrade your plan to unlock all of them."
          ),
        });
        return;
      }
      // turned off before the reason was recorded: it may have been the plan,
      // and it does not come back by itself, so say where to enable it
      if (channels.some((p) => p.disabled && !p.disabledReason)) {
        modal.open({
          title: t('channels_turned_off', 'Some channels are turned off'),
          onlyApprove: true,
          approveLabel: t('ok', 'OK'),
          description: t(
            'channels_turned_off_description',
            "Enable the ones you want from each channel's menu, up to your plan's limit."
          ),
        });
        return;
      }
      // the rest are off because the customer turned them off
      if (channels.some((p) => p.disabled)) {
        return;
      }
      modal.open({
        title: t('channels_enabled_again', 'Your channels are enabled'),
        onlyApprove: true,
        approveLabel: t('ok', 'OK'),
        description: t(
          'channels_enabled_again_description',
          'All of your connected channels were enabled again and are ready to publish.'
        ),
      });
    })();
  }, [check, integrations]);

  return null;
};
