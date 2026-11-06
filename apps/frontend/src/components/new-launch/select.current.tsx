'use client';

import {
  FC,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  SelectedIntegrations,
  useLaunchStore,
} from '@gitroom/frontend/components/new-launch/store';
import clsx from 'clsx';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useShallow } from 'zustand/react/shallow';
import { GlobalIcon } from '@gitroom/frontend/components/ui/icons';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import {
  useDecisionModal,
  useModals,
} from '@gitroom/frontend/components/layout/new-modal';
import { countLength } from '@gitroom/helpers/utils/count.length';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

export function useHasScroll(ref: RefObject<HTMLElement | null>): boolean {
  const [hasHorizontalScroll, setHasHorizontalScroll] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const checkScroll = () => {
      const el = ref.current;
      if (el) {
        setHasHorizontalScroll(el.scrollWidth > el.clientWidth);
      }
    };

    checkScroll(); // initial check

    const resizeObserver = new ResizeObserver(checkScroll);
    resizeObserver.observe(ref.current);

    const mutationObserver = new MutationObserver(checkScroll);
    mutationObserver.observe(ref.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [ref]);

  return hasHorizontalScroll;
}

export const SelectCurrent: FC = () => {
  const modals = useDecisionModal();
  const existingData = useExistingData();
  const {
    selectedIntegrations,
    current,
    setCurrent,
    locked,
    setHide,
    addOrRemoveSelectedIntegration,
  } = useLaunchStore(
    useShallow((state) => ({
      selectedIntegrations: state.selectedIntegrations,
      addOrRemoveSelectedIntegration: state.addOrRemoveSelectedIntegration,
      current: state.current,
      setCurrent: state.setCurrent,
      locked: state.locked,
      setHide: state.setHide,
    }))
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const hasScroll = useHasScroll(contentRef);

  const removeSocial = useCallback(
    (sIntegration: Integrations) => async (e: any) => {
      e.stopPropagation();
      e.preventDefault();
      const open = await modals.open({
        title: 'Remove Social Account',
        description:
          'Are you sure you want to remove this social from scheduling?',
      });

      if (!open) {
        return;
      }

      addOrRemoveSelectedIntegration(sIntegration, {});
    },
    []
  );

  return (
    <>
      <div className="select-none left-0 absolute w-full z-[100] px-[20px] mobile:static mobile:px-0">
        <div
          ref={contentRef}
          className={clsx(
            'flex gap-[6px] mobile:gap-[4px] w-full overflow-x-auto scrollbar scrollbar-thumb-tableBorder scrollbar-track-secondary mobile:scrollbar-none',
            locked && 'opacity-50 pointer-events-none'
          )}
        >
          {/* an existing post opens on its channels, without the global mode */}
          {!existingData.integration && (
            <div
              onClick={() => {
                setHide(true);
                setCurrent('global');
              }}
              className={clsx(
                'cursor-pointer flex gap-[8px] rounded-[8px] w-[40px] h-[40px] mobile:w-[44px] mobile:h-[44px] mobile:shrink-0 justify-center items-center bg-newBgLineColor mobile:bg-newSettings',
                current !== 'global'
                  ? 'text-[#A3A3A3]'
                  : 'border mobile:border-[1.5px] border-[#FC69FF] text-[#FC69FF]'
              )}
            >
              <div>
                <GlobalIcon className="mobile:w-[24px] mobile:h-[24px]" />
              </div>
            </div>
          )}
          {selectedIntegrations.map(({ integration }) => (
            <div
              onClick={() => {
                setHide(true);
                setCurrent(integration.id);
              }}
              onKeyDown={(e) => {
                if (
                  e.target === e.currentTarget &&
                  (e.key === 'Enter' || e.key === ' ')
                ) {
                  e.preventDefault();
                  setHide(true);
                  setCurrent(integration.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-pressed={current === integration.id}
              key={integration.id}
              className={clsx(
                'border mobile:border-[1.5px] cursor-pointer relative flex gap-[4px] min-w-[40px] h-[40px] mobile:min-w-[44px] mobile:h-[44px] mobile:shrink-0 rounded-[8px] items-center bg-newBgLineColor mobile:bg-newSettings justify-center outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
                current === integration.id
                  ? 'border-[#FC69FF] text-[#FC69FF]'
                  : 'border-transparent'
              )}
            >
              {/* an existing post keeps its channels, each with its own content */}
              {!existingData.integration && (
                <>
                  <div
                    onClick={removeSocial(integration)}
                    className="absolute justify-center items-center flex mobile:hidden w-[8px] h-[8px] -top-[1px] -start-[3px] bg-red-500 rounded-full text-white text-[8px]"
                  >
                    X
                  </div>
                  <IsGlobal id={integration.id} />
                </>
              )}
              <div
                {...{
                  'data-tooltip-id': 'tooltip',
                  'data-tooltip-content': integration.name,
                }}
                className={clsx(
                  'relative w-[38px] h-[38px] mobile:w-[42px] mobile:h-[42px] shrink-0 rounded-full flex justify-center items-center filter transition-all duration-500'
                )}
              >
                <SafeImage
                  src={integration.picture || '/no-picture.jpg'}
                  className="rounded-full min-w-[26px]"
                  alt={integration.name}
                  width={26}
                  height={26}
                  onError={(e) => {
                    e.currentTarget.src = '/no-picture.jpg';
                    e.currentTarget.srcset = '/no-picture.jpg';
                  }}
                />
                {integration.identifier === 'youtube' ? (
                  <img
                    src="/icons/platforms/youtube.svg"
                    className="absolute z-10 bottom-[2px] end-[2px] min-w-[12px]"
                    width={12}
                  />
                ) : (
                  <SafeImage
                    src={`/icons/platforms/${integration.identifier}.png`}
                    className="min-w-[12px] min-h-[12px] rounded-[3px] absolute z-10 bottom-[6px] end-[6px]"
                    alt={integration.identifier}
                    width={12}
                    height={12}
                  />
                )}
              </div>
              <ChannelCharCount integration={integration} />
            </div>
          ))}
        </div>
      </div>
      <div
        className={clsx(hasScroll ? 'h-[55px]' : 'h-[40px]', 'mobile:hidden')}
      />
    </>
  );
};

export const IsGlobal: FC<{ id: string }> = ({ id }) => {
  const t = useT();
  const { isInternal } = useLaunchStore(
    useShallow((state) => ({
      isInternal: !!state.internal.find((p) => p.integration.id === id),
    }))
  );

  if (!isInternal) {
    return null;
  }

  return (
    <div
      data-tooltip-id="tooltip"
      data-tooltip-content={t(
        'no_longer_global_mode',
        'No longer in global mode'
      )}
      className="w-[8px] h-[8px] bg-[#FC69FF] -top-[1px] -end-[3px] absolute rounded-full"
    />
  );
};

// 3000 shows as 3k, so a long limit doesn't stretch the channel
const shortLimit = (limit: number) =>
  limit >= 10000
    ? `${Math.round(limit / 1000)}k`
    : limit >= 1000
    ? `${Math.round(limit / 100) / 10}k`
    : `${limit}`;

// the characters of the longest post of the channel against the channel limit,
// counted like the server does before it schedules
export const ChannelCharCount: FC<{ integration: Integrations }> = ({
  integration,
}) => {
  const t = useT();
  const { values, limit } = useLaunchStore(
    useShallow((state) => {
      const custom = state.internal.find(
        (p) => p.integration.id === integration.id
      )?.integrationValue;
      return {
        // the same content the channel preview shows
        values: custom?.length ? custom : state.global,
        limit: state.chars[integration.id],
      };
    })
  );

  const count = useMemo(
    () =>
      Math.max(
        0,
        ...values.map((value) =>
          countLength(
            integration.identifier,
            stripHtmlValidation('normal', value.content || '', true)
          )
        )
      ),
    [values, integration.identifier]
  );

  if (!limit || !count) {
    return null;
  }

  const over = count > limit;
  return (
    <div
      data-tooltip-id="tooltip"
      data-tooltip-content={
        over
          ? t(
              'channel_chars_over',
              '{{count}} characters over the {{limit}} limit of {{name}}',
              { count: count - limit, limit, name: integration.name }
            )
          : t(
              'channel_chars_left',
              '{{count}} characters left for {{name}}',
              { count: limit - count, name: integration.name }
            )
      }
      className={clsx(
        'pe-[6px] text-[11px] font-[600] tabular-nums whitespace-nowrap',
        over ? 'text-[#FF3F3F]' : 'text-newTextColor/60'
      )}
    >
      <span aria-hidden="true">
        {count}/{shortLimit(limit)}
      </span>
      <span className="sr-only">
        {t('channel_chars_count', '{{count}} of {{limit}} characters', {
          count,
          limit,
        })}
      </span>
    </div>
  );
};
