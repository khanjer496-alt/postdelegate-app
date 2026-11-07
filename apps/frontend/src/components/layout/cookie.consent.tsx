'use client';

import {
  FC,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import { usePathname, useSearchParams } from 'next/navigation';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { parseReferralCode } from '@gitroom/helpers/affiliate/affiliate.cookie';
import {
  ConsentChoices,
  COOKIE_SETTINGS_EVENT,
  NO_CONSENT,
  openCookieSettings,
  readConsent,
  saveConsent,
} from '@gitroom/helpers/consent/consent.cookie';

const PRIVACY_COOKIES_URL = '/legal/privacy/#cookies';

// the three answers look the same: saying no is as easy as saying yes
const answerButton =
  'flex-1 min-h-[36px] px-[8px] py-[5px] rounded-[8px] border border-newBorder bg-btnSimple text-[12.5px] sm:text-[13px] font-[600] leading-[1.2] hover:opacity-80 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary';

const Switch: FC<{
  checked: boolean;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
  labelledBy: string;
  describedBy: string;
}> = ({ checked, disabled, onChange, labelledBy, describedBy }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-disabled={disabled || undefined}
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    onClick={() => !disabled && onChange?.(!checked)}
    className={clsx(
      'shrink-0 w-[44px] h-[26px] p-[3px] rounded-full border motion-safe:transition-colors outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
      checked
        ? 'bg-btnPrimary border-btnPrimary'
        : 'bg-newBgColor border-newTableBorder',
      disabled && 'opacity-60 cursor-not-allowed'
    )}
  >
    <span
      aria-hidden="true"
      className={clsx(
        'block w-[18px] h-[18px] rounded-full bg-white shadow motion-safe:transition-transform',
        checked ? 'translate-x-[18px] rtl:-translate-x-[18px]' : 'translate-x-0'
      )}
    />
  </button>
);

const Category: FC<{
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
}> = ({ title, description, checked, disabled, onChange }) => {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-[12px]">
      <div className="flex flex-col gap-[2px] min-w-0">
        <span id={`${id}-title`} className="text-[13px] font-[600]">
          {title}
        </span>
        <span id={`${id}-desc`} className="text-[12px] text-textItemBlur">
          {description}
        </span>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        labelledBy={`${id}-title`}
        describedBy={`${id}-desc`}
      />
    </div>
  );
};

// The cookie banner. It opens by itself only on the signed-out pages (/auth)
// until a choice is saved, never inside the app or on a checkout or trial
// return (check=). Cookie settings links open it anywhere. Nothing optional is
// stored before a category is switched on, see AffiliateSaver and UtmSaver.
export const CookieConsent: FC = () => {
  const t = useT();
  const pathname = usePathname();
  const query = useSearchParams();
  const { consentCookieDomain, analyticsTools } = useVariables();
  const [view, setView] = useState<'closed' | 'banner' | 'customize'>(
    'closed'
  );
  const [choices, setChoices] = useState<ConsentChoices>(NO_CONSENT);
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const hasAnalytics = !!analyticsTools?.length;
  const referred = !!parseReferralCode(query.get('ref'));

  useEffect(() => {
    if (
      pathname?.startsWith('/auth') &&
      !query.get('check') &&
      !readConsent(document.cookie)
    ) {
      setView('banner');
    }
  }, []);

  useEffect(() => {
    const open = () => {
      opener.current = document.activeElement as HTMLElement | null;
      setChoices(readConsent(document.cookie) || NO_CONSENT);
      setView('customize');
    };
    window.addEventListener(COOKIE_SETTINGS_EVENT, open);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, open);
  }, []);

  // moved focus only when someone asked for the settings, the banner itself
  // never steals it
  useEffect(() => {
    if (view === 'customize') {
      heading.current?.focus();
    }
  }, [view]);

  // The banner never sits on top of the page's main button (data-primary-cta):
  // it moves to the other corner, or on phones waits, invisible, until the
  // button scrolled away
  const [covering, setCovering] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const atEndRef = useRef(false);
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    if (view !== 'banner' || !card.current) {
      setCovering(false);
      return;
    }
    const covers = (area: DOMRect) =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-primary-cta]')
      ).some((cta) => {
        const rect = cta.getBoundingClientRect();
        return (
          rect.height > 0 &&
          rect.bottom > area.top &&
          rect.top < area.bottom &&
          rect.right > area.left &&
          rect.left < area.right
        );
      });
    const check = () => {
      const area = card.current?.getBoundingClientRect();
      if (!area) {
        return;
      }
      // once it is showing and the visitor scrolled, it stays where it is
      if (window.innerWidth < 640) {
        setCovering((hidden) =>
          hidden || !scrolled.current ? covers(area) : false
        );
        return;
      }
      // the same card in each bottom corner
      const startArea = new DOMRect(16, area.top, area.width, area.height);
      const endArea = new DOMRect(
        window.innerWidth - area.width - 16,
        area.top,
        area.width,
        area.height
      );
      const useEnd = atEndRef.current || covers(startArea);
      atEndRef.current = useEnd;
      setAtEnd(useEnd);
      setCovering((hidden) =>
        hidden || !scrolled.current
          ? covers(useEnd ? endArea : startArea)
          : false
      );
    };
    const onScroll = () => {
      check();
      scrolled.current = true;
    };
    check();
    // again once late content and fonts settled
    const timers = [700, 1500].map((delay) => setTimeout(check, delay));
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', check);
    };
  }, [view]);

  // keeps the end of the page reachable above the banner on phones
  useLayoutEffect(() => {
    if (view === 'closed' || !card.current) {
      return;
    }
    const resize = new ResizeObserver(() => {
      document.body.style.paddingBottom = `${
        (card.current?.offsetHeight || 0) + 16
      }px`;
    });
    resize.observe(card.current);
    return () => {
      resize.disconnect();
      document.body.style.paddingBottom = '';
    };
  }, [view]);

  const close = useCallback(() => {
    setView('closed');
    opener.current?.focus?.();
    opener.current = null;
  }, []);

  // without analytics here the saved analytics choice is kept as it was
  const save = useCallback(
    (value: ConsentChoices) => {
      saveConsent(
        {
          ref: value.ref,
          analytics: hasAnalytics
            ? value.analytics
            : value.analytics && !!readConsent(document.cookie)?.analytics,
        },
        consentCookieDomain || ''
      );
      close();
    },
    [consentCookieDomain, hasAnalytics, close]
  );

  useEffect(() => {
    if (view === 'closed') {
      return;
    }
    // closes without saving anything, the banner comes back on the next page.
    // Only from inside it, so Escape still closes menus elsewhere on the page
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        card.current?.contains(document.activeElement)
      ) {
        close();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [view, close]);

  if (view === 'closed') {
    return null;
  }

  return (
    <div
      ref={card}
      // where focus came from, to return it there when the banner closes
      onFocus={(event) => {
        const from = event.relatedTarget as HTMLElement | null;
        if (!opener.current && from && !card.current?.contains(from)) {
          opener.current = from;
        }
      }}
      role="region"
      aria-labelledby={titleId}
      data-cookie-consent=""
      aria-hidden={covering || undefined}
      className={clsx(
        covering && 'invisible',
        // physical sides: the RTL plugin's start/end utilities outrank sm:
        atEnd
          ? 'sm:left-auto sm:right-[16px]'
          : 'sm:left-[16px] sm:right-auto',
        'fixed z-[800] bottom-0 left-0 right-0 sm:bottom-[16px] sm:w-[380px] flex flex-col gap-[6px] sm:gap-[10px] px-[16px] py-[10px] sm:p-[16px] sm:rounded-[12px] border-t sm:border border-newBorder bg-newBgColorInner text-newTextColor shadow-lg text-[12.5px] sm:text-[13px] leading-[1.4] motion-safe:animate-fadeIn'
      )}
    >
      <div className="flex items-center justify-between gap-[8px]">
        <h2
          id={titleId}
          ref={heading}
          tabIndex={-1}
          className="text-[14px] font-[700] outline-none"
        >
          {view === 'customize'
            ? t('cookie_settings', 'Cookie settings')
            : t('cookies_title', 'Cookies')}
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label={t('close', 'Close')}
          title={t('close', 'Close')}
          className="w-[28px] h-[28px] -my-[4px] -me-[6px] flex items-center justify-center rounded-[6px] opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <p>
        {hasAnalytics
          ? t(
              'cookies_text_analytics',
              'We use a few cookies to keep you signed in and, if you agree, to credit the person who referred you and to measure how PostDelegate is used.'
            )
          : t(
              'cookies_text',
              'We use a few cookies to keep you signed in and, if you agree, to credit the person who referred you.'
            )}{' '}
        <a
          href={PRIVACY_COOKIES_URL}
          target="_blank"
          rel="noopener"
          className="underline underline-offset-2 hover:opacity-80"
        >
          {t('cookies_learn_more', 'Learn more')}
        </a>
      </p>
      {referred && view === 'banner' && (
        <p className="text-textItemBlur">
          {t(
            'cookies_referral_note',
            'You followed a referral link. Accepting lets us credit the person who sent it.'
          )}
        </p>
      )}
      {view === 'customize' ? (
        <>
          <div className="flex flex-col gap-[12px] py-[4px]">
            <Category
              title={t('cookies_necessary', 'Strictly necessary')}
              description={t(
                'cookies_necessary_text',
                'Sign-in, security and your settings, including this choice. Always on.'
              )}
              checked={true}
              disabled={true}
            />
            <Category
              title={t('cookies_referral', 'Referral and campaign attribution')}
              description={t(
                'cookies_referral_text',
                'Remembers the referral or campaign link you came from, so the right person gets credit when you sign up.'
              )}
              checked={choices.ref}
              onChange={(ref) => setChoices((c) => ({ ...c, ref }))}
            />
            {hasAnalytics && (
              <Category
                title={t('cookies_analytics', 'Analytics')}
                description={t(
                  'cookies_analytics_text',
                  'Measures how PostDelegate is used, with {{tools}}.',
                  { tools: analyticsTools!.join(', ') }
                )}
                checked={choices.analytics}
                onChange={(analytics) =>
                  setChoices((c) => ({ ...c, analytics }))
                }
              />
            )}
          </div>
          <div className="flex gap-[8px]">
            <button
              type="button"
              onClick={() => save(choices)}
              className={answerButton}
            >
              {t('cookies_save', 'Save choices')}
            </button>
          </div>
        </>
      ) : (
        <div className="flex gap-[8px]">
          <button
            type="button"
            onClick={() => save(NO_CONSENT)}
            className={answerButton}
          >
            {t('cookies_reject', 'Reject non-essential')}
          </button>
          <button
            type="button"
            onClick={() => {
              setChoices(readConsent(document.cookie) || NO_CONSENT);
              setView('customize');
            }}
            className={answerButton}
          >
            {t('cookies_customize', 'Customize')}
          </button>
          <button
            type="button"
            onClick={() => save({ ref: true, analytics: true })}
            className={answerButton}
          >
            {t('cookies_accept', 'Accept all')}
          </button>
        </div>
      )}
    </div>
  );
};

// A link that reopens the cookie banner, for footers and settings pages
export const CookieSettingsButton: FC<{ className?: string }> = ({
  className,
}) => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={openCookieSettings}
      className={className}
    >
      {t('cookie_settings', 'Cookie settings')}
    </button>
  );
};
