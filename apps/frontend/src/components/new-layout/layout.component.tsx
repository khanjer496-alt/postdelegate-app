'use client';

import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { jakartaSans } from '@gitroom/frontend/fonts/plus-jakarta-sans/plus.jakarta.sans.font';
const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

import clsx from 'clsx';
import dynamic from 'next/dynamic';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { usePathname, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { CheckPayment } from '@gitroom/frontend/components/layout/check.payment';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { ShowMediaBoxModal } from '@gitroom/frontend/components/media/media.component';
import { ShowLinkedinCompany } from '@gitroom/frontend/components/launches/helpers/linkedin.component';
import { MediaSettingsLayout } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { NewSubscription } from '@gitroom/frontend/components/layout/new.subscription';
import { Support } from '@gitroom/frontend/components/layout/support';
import { ReviewPrompt } from '@gitroom/frontend/components/reviews/review.prompt';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { InviteError } from '@gitroom/frontend/components/layout/invite.error';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { CopilotKit } from '@copilotkit/react-core';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Impersonate } from '@gitroom/frontend/components/layout/impersonate';
import { AnnouncementBanner } from '@gitroom/frontend/components/layout/announcement.banner';
import { Title } from '@gitroom/frontend/components/layout/title';
import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { InvoicesComponent } from '@gitroom/frontend/components/layout/invoices.component';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { PreConditionComponent } from '@gitroom/frontend/components/layout/pre-condition.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import { FirstBillingComponent } from '@gitroom/frontend/components/billing/first.billing.component';
import { TrialCountdown } from '@gitroom/frontend/components/billing/trial.banner';
import { TrialTracker } from '@gitroom/frontend/components/layout/gtm.component';
import { setSentryUser } from '@gitroom/react/sentry/initialize.sentry.client';
import { setUserTimezone } from '@gitroom/frontend/components/layout/set.timezone';
import { CommandPalette } from '@gitroom/frontend/components/layout/command.palette';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useClickOutside } from '@mantine/hooks';
import { useHasOpenModal } from '@gitroom/frontend/components/layout/new-modal';

// On phones and tablets the secondary top bar icons fold into a "more" menu,
// on desktop the wrappers are display: contents and the icons sit inline
const TopBarMore: FC<{ children: ReactNode }> = ({ children }) => {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div
      ref={ref}
      className="contents mobile:flex mobile:relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="hidden mobile:flex items-center justify-center w-[40px] h-[40px] rounded-[8px] hover:text-newTextColor hover:bg-boxFocused"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={t('more_options', 'More options')}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      <div
        className={clsx(
          'contents',
          'mobile:absolute mobile:top-[calc(100%+8px)] mobile:end-0 mobile:z-[300] mobile:flex mobile:items-center mobile:gap-[4px] mobile:p-[6px] mobile:rounded-[12px] mobile:bg-newBgColorInner mobile:ring-1 mobile:ring-newBorder mobile:shadow-menu',
          !open && 'mobile:hidden'
        )}
      >
        {children}
      </div>
    </div>
  );
};

export const LayoutComponent = ({ children }: { children: ReactNode }) => {
  const fetch = useFetch();
  const t = useT();

  const { backendUrl, billingEnabled, isGeneral } = useVariables();

  // Feedback icon component attaches Sentry feedback to a top-bar icon when DSN is present
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const modalOpen = useHasOpenModal();
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    // the drawer takes the focus on phones, the menu button gets it back
    document
      .querySelector<HTMLElement>('#main-menu a, #main-menu button')
      ?.focus({ preventScroll: true });
    const close = (e: KeyboardEvent) => {
      // a modal on top of the drawer handles its own Escape
      if (e.key === 'Escape' && !modalOpenRef.current) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('keydown', close);
      const toggle = document.getElementById('main-menu-toggle');
      if (toggle && toggle.getClientRects().length) {
        toggle.focus({ preventScroll: true });
      }
    };
  }, [menuOpen]);
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, []);
  const { data: user, mutate } = useSWR('/user/self', load, {
    // set before anything renders a date in the user's timezone
    onSuccess: (data) => setUserTimezone(data?.timezoneName),
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });

  useEffect(() => {
    setSentryUser(
      user ? { id: user.id, email: user.email, orgId: user.orgId } : null
    );
  }, [user]);

  if (!user) return null;

  return (
    <ContextWrapper user={user}>
      <CopilotKit
        credentials="include"
        runtimeUrl={backendUrl + '/copilot/chat'}
        useSingleEndpoint={true}
        showDevConsole={false}
      >
        <MantineWrapper>
          <ToolTip />
          <Toaster />
          <TrialTracker />
          <CheckPayment check={searchParams.get('check') || ''} mutate={mutate}>
            <ShowMediaBoxModal />
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <PreConditionComponent />
            <NewSubscription />
            <ContinueProvider />
            <InviteError />
            <div
              className={clsx(
                'flex flex-col min-h-screen min-w-screen text-newTextColor p-[12px] mobile:p-[8px] mobile:pb-[80px]',
                jakartaSans.className
              )}
            >
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:fixed focus:top-[12px] focus:start-[12px] focus:z-[1000] focus:px-[16px] focus:py-[10px] focus:rounded-[8px] focus:bg-btnCta focus:text-btnCtaText focus:font-[600]"
              >
                {t('skip_to_content', 'Skip to content')}
              </a>
              <div>{user?.admin ? <Impersonate /> : <div />}</div>
              {user.tier === 'FREE' && isGeneral && billingEnabled ? (
                <FirstBillingComponent />
              ) : (
                <>
                  <AnnouncementBanner />
                  <div className="flex-1 flex gap-[8px] mobile:gap-0">
                    <Support />
                    <ReviewPrompt />
                    {menuOpen && (
                      <div
                        className="hidden mobile:block fixed inset-0 bg-newBackdrop opacity-60 z-[490]"
                        onClick={() => setMenuOpen(false)}
                      />
                    )}
                    <nav
                      id="main-menu"
                      aria-label={t('main_menu', 'Main menu')}
                      className={clsx(
                        'flex flex-col bg-newBgColorInner w-[80px] rounded-[16px] ring-1 ring-newBorder mobile:ring-0 mobile:fixed mobile:top-0 mobile:bottom-0 mobile:start-0 mobile:z-[491] mobile:rounded-none mobile:overflow-y-auto mobile:overflow-x-hidden',
                        !menuOpen && 'mobile:hidden'
                      )}
                      onClick={() => setMenuOpen(false)}
                    >
                      <div
                        id="left-menu"
                        className={clsx(
                          'fixed h-full w-[64px] start-[20px] flex flex-1 top-0 mobile:static mobile:h-auto mobile:min-h-full mobile:mx-auto',
                          user?.admin && 'pt-[52px] max-h-[1000px]:w-[500px]'
                        )}
                      >
                        <div className="flex flex-col h-full gap-[32px] mobile:gap-[16px] flex-1 pt-[12px] pb-[20px] mobile:pb-[12px]">
                          <div className="flex justify-center">
                            <Logo />
                          </div>
                          <TopMenu />
                        </div>
                      </div>
                    </nav>
                    <div className="flex-1 min-w-0 bg-newBgLineColor rounded-[16px] ring-1 ring-newBorder overflow-hidden flex flex-col gap-[1px] blurMe">
                      {/* relative: the notifications popup spans this bar on phones */}
                      {/* the narrowest phones have no room for the page title next to the trial countdown */}
                      <header className="relative flex bg-newBgColorInner h-[80px] mobile:h-[64px] px-[20px] mobile:px-[12px] gap-[12px] mobile:gap-[8px] items-center [@media(max-width:480px)]:[&:has([data-trial-countdown])_h1]:hidden">
                        <button
                          type="button"
                          className="hidden mobile:flex shrink-0 items-center justify-center w-[44px] h-[44px] -ms-[10px] rounded-[8px] text-textItemBlur hover:text-newTextColor hover:bg-boxFocused"
                          id="main-menu-toggle"
                          onClick={() => setMenuOpen(true)}
                          aria-label={t('open_menu', 'Open menu')}
                          aria-controls="main-menu"
                          aria-expanded={menuOpen}
                        >
                          <svg
                            aria-hidden="true"
                            xmlns="http://www.w3.org/2000/svg"
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M3 6H21M3 12H21M3 18H21"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                        <div className="text-[24px] mobile:text-[20px] font-[600] flex flex-1 min-w-0">
                          <Title />
                        </div>
                        <div className="flex gap-[20px] mobile:gap-[4px] items-center text-textItemBlur">
                          <CommandPalette />
                          <TrialCountdown />
                          <TopBarMore>
                            <StreakComponent />
                            <div className="w-[1px] h-[20px] bg-blockSeparator mobile:hidden" />
                            <OrganizationSelector />
                            <InvoicesComponent />
                            <div className="hover:text-newTextColor">
                              <ModeComponent />
                            </div>
                            <div className="w-[1px] h-[20px] bg-blockSeparator mobile:hidden" />
                            <LanguageComponent />
                            <div className="w-[1px] h-[20px] bg-blockSeparator mobile:hidden" />
                            <AttachToFeedbackIcon />
                          </TopBarMore>
                          <NotificationComponent />
                        </div>
                      </header>
                      <main
                        id="main-content"
                        tabIndex={-1}
                        className="flex flex-1 min-w-0 gap-[1px] mobile:flex-col"
                      >
                        {children}
                      </main>
                    </div>
                  </div>
                </>
              )}
            </div>
          </CheckPayment>
        </MantineWrapper>
      </CopilotKit>
    </ContextWrapper>
  );
};
