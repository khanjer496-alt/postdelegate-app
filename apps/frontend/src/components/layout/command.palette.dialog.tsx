'use client';

import React, {
  FC,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import useSWR, { useSWRConfig } from 'swr';
import { orderBy } from 'lodash';
import { getCookie } from 'react-use-cookie';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useMenuItem } from '@gitroom/frontend/components/layout/top.menu';
import { modeToggleEmitter } from '@gitroom/frontend/components/layout/mode.component';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useCreatePost } from '@gitroom/frontend/components/launches/new.post';
import {
  CustomVariables,
  useAddProvider,
} from '@gitroom/frontend/components/launches/add.provider.component';
import { BotPicture } from '@gitroom/frontend/components/launches/bot.picture';
import { SettingsModal } from '@gitroom/frontend/components/launches/settings.modal';
import { TimeTable } from '@gitroom/frontend/components/launches/time.table';
import { CustomerModal } from '@gitroom/frontend/components/launches/customer.modal';

interface PaletteItem {
  id: string;
  label: string;
  keywords?: string;
  hint?: string;
  icon: ReactNode;
  // stay open after running (opens a nested page)
  keepOpen?: boolean;
  run: () => void;
}

interface PaletteGroup {
  id: string;
  label: string;
  items: PaletteItem[];
}

type Page =
  | { type: 'root' }
  | { type: 'workspaces' }
  | { type: 'channel'; id: string };

const useSets = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/sets')).json();
  }, []);
  // same key as the calendar, so both share one request
  return useSWR('sets', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

const useOrganizations = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return await (await fetch('/user/organizations')).json();
  }, []);
  // same key as the organization selector in the top bar
  return useSWR('organizations', load, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
    revalidateOnReconnect: false,
  });
};

// prefix > word start > substring > in-order letters, 0 means no match
const matchScore = (query: string, text: string) => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return 1;
  }
  const s = text.toLowerCase();
  const index = s.indexOf(q);
  if (index === 0) {
    return 100;
  }
  if (index > 0) {
    return (/[\s\-_/.]/.test(s[index - 1]) ? 80 : 60) - index / 100;
  }
  let position = -1;
  let gaps = 0;
  for (const char of q) {
    if (char === ' ') {
      continue;
    }
    const next = s.indexOf(char, position + 1);
    if (next === -1) {
      return 0;
    }
    gaps += next - position - 1;
    position = next;
  }
  return Math.max(1, 40 - gaps);
};

const Icon: FC<{ d: string }> = ({ d }) => (
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const icons = {
  plus: 'M12 5v14M5 12h14',
  channel:
    'M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-.5.5M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l.5-.5',
  theme: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  workspace:
    'M3 21h18M5 21V7l7-4 7 4v14M9 10h1M14 10h1M9 14h1M14 14h1M10 21v-3h4v3',
  picture: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  settings:
    'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  time: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  group: 'M3 7h7l2 2h9v10H3V7Z',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
};

export const CommandPaletteDialog: FC<{ onClose: () => void }> = ({
  onClose,
}) => {
  const t = useT();
  const user = useUser();
  const router = useRouter();
  const fetch = useFetch();
  const toast = useToaster();
  const modal = useModals();
  const { mutate } = useSWRConfig();
  const { billingEnabled } = useVariables();
  const { all: menuItems } = useMenuItem();
  const { data: integrationList, mutate: mutateIntegrations } =
    useIntegrationList();
  const { data: sets } = useSets();
  const { data: organizations } = useOrganizations();

  const [query, setQuery] = useState('');
  const [page, setPage] = useState<Page>({ type: 'root' });
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const integrations = useMemo(
    () =>
      orderBy(
        integrationList || [],
        ['type', 'disabled', 'identifier'],
        ['desc', 'asc', 'asc']
      ),
    [integrationList]
  );

  const reloadCalendarView = useCallback(() => {
    // revalidate only: passing data would blank the calendar while it reloads
    mutate(
      (key: string) => typeof key === 'string' && key.startsWith('/posts-')
    );
  }, [mutate]);

  const createPost = useCreatePost({
    integrations,
    sets: sets || [],
    reloadCalendarView,
  });
  const addChannel = useAddProvider(() => mutateIntegrations());

  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (restoreFocus.current?.isConnected) {
        restoreFocus.current.focus();
      }
    };
  }, []);

  // run an action: the menu closes first so modals open on a clean page
  const execute = useCallback(
    (item: PaletteItem) => {
      if (item.keepOpen) {
        item.run();
        setQuery('');
        setActive(0);
        inputRef.current?.focus();
        return;
      }
      restoreFocus.current = null;
      onClose();
      item.run();
    },
    [onClose]
  );

  const reconnect = useCallback(
    async (integration: any) => {
      if (integration.isCustomFields) {
        modal.openModal({
          title: t('custom_url', 'Custom URL'),
          withCloseButton: false,
          classNames: { modal: 'md' },
          children: (
            <CustomVariables
              identifier={integration.identifier}
              gotoUrl={(url: string) => router.push(url)}
              variables={integration.customFields || []}
            />
          ),
        });
        return;
      }
      const { url } = await (
        await fetch(
          `/integrations/social/${integration.identifier}?refresh=${integration.internalId}`
        )
      ).json();
      window.location.href = url;
    },
    [t, fetch, modal, router]
  );

  const groups = useMemo((): PaletteGroup[] => {
    if (page.type === 'workspaces') {
      return [
        {
          id: 'workspaces',
          label: t('quick_menu_workspaces', 'Workspaces'),
          items: (organizations || [])
            .filter((org: any) => org.id !== user?.orgId)
            .map((org: any) => ({
              id: `org-${org.id}`,
              label: org.name,
              icon: <Icon d={icons.workspace} />,
              run: async () => {
                await fetch('/user/change-org', {
                  method: 'POST',
                  body: JSON.stringify({ id: org.id }),
                });
                window.location.reload();
              },
            })),
        },
      ];
    }

    if (page.type === 'channel') {
      const integration: any = integrations.find((p) => p.id === page.id);
      if (!integration) {
        return [];
      }
      const items: PaletteItem[] = [];
      if (integration.refreshNeeded) {
        items.push({
          id: 'reconnect',
          label: t('reconnect_channel', 'Reconnect channel'),
          icon: <Icon d={icons.refresh} />,
          run: () => reconnect(integration),
        });
      }
      if (integration.changeProfilePicture || integration.changeNickName) {
        items.push({
          id: 'preferences',
          label: t('quick_menu_preferences', 'Preferences'),
          hint: [
            integration.changeProfilePicture && t('picture', 'Picture'),
            integration.changeNickName && t('label_nickname', 'Nickname'),
          ]
            .filter(Boolean)
            .join(' / '),
          icon: <Icon d={icons.picture} />,
          run: () =>
            modal.openModal({
              classNames: {
                modal: 'w-[100%] max-w-[600px] bg-transparent text-textColor',
              },
              size: '100%',
              withCloseButton: false,
              closeOnEscape: true,
              closeOnClickOutside: true,
              children: (
                <BotPicture
                  canChangeProfilePicture={integration.changeProfilePicture}
                  canChangeNickName={integration.changeNickName}
                  integration={integration}
                  mutate={mutateIntegrations}
                />
              ),
            }),
        });
      }
      if (integration.additionalSettings !== '[]') {
        items.push({
          id: 'additional-settings',
          label: t('additional_settings', 'Additional Settings'),
          icon: <Icon d={icons.settings} />,
          run: () =>
            modal.openModal({
              title: t('additional_settings', 'Additional Settings'),
              children: (
                <SettingsModal
                  integration={integration}
                  onClose={() => {
                    mutateIntegrations();
                    toast.show(
                      t('settings_updated', 'Settings Updated'),
                      'success'
                    );
                  }}
                />
              ),
            }),
        });
      }
      items.push(
        {
          id: 'time-slots',
          label: t('edit_time_slots', 'Edit Time Slots'),
          icon: <Icon d={icons.time} />,
          run: () =>
            modal.openModal({
              withCloseButton: true,
              closeOnEscape: false,
              closeOnClickOutside: false,
              askClose: true,
              title: t('time_table_slots', 'Time Table Slots'),
              children: (
                <TimeTable
                  integration={integration}
                  mutate={mutateIntegrations}
                />
              ),
            }),
        },
        {
          id: 'group',
          label: t('move_add_to_group', 'Move / add to group'),
          icon: <Icon d={icons.group} />,
          run: () =>
            modal.openModal({
              classNames: { modal: 'md' },
              title: t('move_add_to_group', 'Move / Add to group'),
              withCloseButton: false,
              closeOnEscape: true,
              closeOnClickOutside: true,
              children: (
                <CustomerModal
                  integration={integration}
                  onClose={() => {
                    mutateIntegrations();
                    toast.show(
                      t('customer_updated', 'Customer Updated'),
                      'success'
                    );
                  }}
                />
              ),
            }),
        }
      );
      return [{ id: 'channel', label: integration.name, items }];
    }

    const actions: PaletteItem[] = [];
    if (user?.orgId && integrations.some((p: any) => !p.disabled)) {
      actions.push({
        id: 'create-post',
        label: t('create_new_post', 'Create Post'),
        keywords: 'new post compose write schedule',
        icon: <Icon d={icons.plus} />,
        run: createPost,
      });
    }
    if (user?.orgId) {
      actions.push({
        id: 'add-channel',
        label: t('quick_menu_add_channel', 'Add channel'),
        keywords: 'connect integration account social',
        icon: <Icon d={icons.channel} />,
        run: addChannel,
      });
    }
    if (modeToggleEmitter.listenerCount('toggle') > 0) {
      const dark = getCookie('mode', 'dark') === 'dark';
      actions.push({
        id: 'toggle-theme',
        label: dark
          ? t('quick_menu_light_mode', 'Switch to light mode')
          : t('quick_menu_dark_mode', 'Switch to dark mode'),
        keywords: 'theme appearance dark light mode',
        icon: <Icon d={icons.theme} />,
        run: () => modeToggleEmitter.emit('toggle'),
      });
    }
    if ((organizations?.length || 0) > 1) {
      actions.push({
        id: 'switch-workspace',
        label: t('quick_menu_switch_workspace', 'Switch workspace'),
        keywords: 'organization team account',
        icon: <Icon d={icons.workspace} />,
        keepOpen: true,
        run: () => setPage({ type: 'workspaces' }),
      });
    }

    // the same visibility rules as the side menu
    const navigation: PaletteItem[] = menuItems
      .filter((item) => {
        if (item.hide) {
          return false;
        }
        if (!user?.orgId && !item.role) {
          return false;
        }
        if (item.requireBilling && !billingEnabled) {
          return false;
        }
        if (item.requireAi && !user?.aiAvailable) {
          return false;
        }
        if (item.path === '/billing' && user?.isLifetime) {
          return false;
        }
        if (item.role) {
          return item.role.includes(user?.role!);
        }
        return true;
      })
      .map((item) => ({
        id: `nav-${item.path}`,
        label: item.onClick
          ? item.title || item.name
          : t('quick_menu_go_to', 'Go to {{name}}', { name: item.name }),
        keywords: item.name,
        icon: (
          <span className="flex [&_svg]:w-[18px] [&_svg]:h-[18px]">
            {item.icon}
          </span>
        ),
        run: item.onClick ? item.onClick : () => router.push(item.path),
      }));

    const channels: PaletteItem[] = integrations
      .filter((p: any) => !p.inBetweenSteps)
      .map((integration: any) => ({
        id: `channel-${integration.id}`,
        label: integration.name,
        keywords: integration.identifier,
        hint: integration.refreshNeeded
          ? t('quick_menu_disconnected', 'Disconnected')
          : integration.disabled
          ? t('quick_menu_disabled', 'Disabled')
          : t('quick_menu_preferences', 'Preferences'),
        icon: (
          <ImageWithFallback
            fallbackSrc={`/icons/platforms/${integration.identifier}.png`}
            src={integration.picture}
            className={clsx(
              'rounded-[6px]',
              integration.disabled && 'opacity-50'
            )}
            alt=""
            width={20}
            height={20}
          />
        ),
        keepOpen: true,
        run: () => setPage({ type: 'channel', id: integration.id }),
      }));

    return [
      {
        id: 'actions',
        label: t('quick_menu_actions', 'Actions'),
        items: actions,
      },
      {
        id: 'navigation',
        label: t('quick_menu_navigation', 'Go to'),
        items: navigation,
      },
      { id: 'channels', label: t('channels', 'Channels'), items: channels },
    ];
  }, [
    page,
    integrations,
    organizations,
    menuItems,
    user,
    billingEnabled,
    createPost,
    addChannel,
    reconnect,
    mutateIntegrations,
    modal,
    router,
    toast,
    t,
  ]);

  const filtered = useMemo(() => {
    return groups
      .map((group) => ({
        ...group,
        items: group.items
          .map((item) => ({
            item,
            score: Math.max(
              matchScore(query, item.label),
              matchScore(query, item.keywords || '') * 0.9
            ),
          }))
          .filter((p) => p.score > 0)
          .sort((a, b) => (query.trim() ? b.score - a.score : 0))
          .map((p) => p.item),
      }))
      .filter((group) => group.items.length);
  }, [groups, query]);

  const flat = useMemo(() => filtered.flatMap((g) => g.items), [filtered]);
  const optionId = useCallback(
    (index: number) => `${baseId}-option-${index}`,
    [baseId]
  );

  useEffect(() => {
    setActive(0);
  }, [query, page]);

  useEffect(() => {
    document
      .getElementById(optionId(active))
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, optionId]);

  const back = useCallback(() => {
    setPage({ type: 'root' });
    setQuery('');
    inputRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (page.type !== 'root') {
          back();
        } else {
          onClose();
        }
        return;
      }
      if (e.key === 'Tab') {
        // keep the focus inside the menu
        const focusable = Array.from(
          panelRef.current?.querySelectorAll<HTMLElement>(
            'input, button:not([disabled])'
          ) || []
        );
        if (focusable.length) {
          e.preventDefault();
          const current = focusable.indexOf(
            document.activeElement as HTMLElement
          );
          const next =
            (current + (e.shiftKey ? -1 : 1) + focusable.length) %
            focusable.length;
          focusable[next].focus();
        }
        return;
      }
      if (e.target !== inputRef.current) {
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!flat.length) {
          return;
        }
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((value) => (value + step + flat.length) % flat.length);
      } else if (e.key === 'Home' && flat.length && !query) {
        e.preventDefault();
        setActive(0);
      } else if (e.key === 'End' && flat.length && !query) {
        e.preventDefault();
        setActive(flat.length - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flat[active]) {
          execute(flat[active]);
        }
      } else if (e.key === 'Backspace' && !query && page.type !== 'root') {
        e.preventDefault();
        back();
      }
    },
    [page, flat, active, query, execute, back, onClose]
  );

  const pageLabel =
    page.type === 'workspaces'
      ? t('quick_menu_switch_workspace', 'Switch workspace')
      : page.type === 'channel'
      ? (integrations.find((p) => p.id === page.id) as any)?.name
      : '';

  let index = -1;

  return createPortal(
    <div
      className="fixed inset-0 z-[600] flex justify-center items-start pt-[12vh] mobile:pt-[16px] px-[16px]"
      onKeyDown={onKeyDown}
    >
      <div
        className="absolute inset-0 bg-newBackdrop opacity-60 animate-fadeIn"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('quick_menu_title', 'Quick menu')}
        className="relative w-full max-w-[640px] flex flex-col bg-newBgColorInner text-newTextColor border border-newTableBorder rounded-[16px] shadow-menu overflow-hidden animate-fadeIn"
      >
        <div className="flex items-center gap-[10px] px-[16px] h-[56px] border-b border-newTableBorder">
          {page.type !== 'root' ? (
            <button
              type="button"
              onClick={back}
              aria-label={t('quick_menu_back', 'Back')}
              className="flex items-center gap-[6px] shrink-0 max-w-[45%] h-[28px] px-[8px] rounded-[6px] bg-btnSimple text-[12px] text-newTextColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="rtl:rotate-180"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <span className="truncate">{pageLabel}</span>
            </button>
          ) : (
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="shrink-0 text-textItemBlur"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat[active] ? optionId(active) : undefined}
            aria-label={t(
              'quick_menu_search_label',
              'Search actions, pages and channels'
            )}
            placeholder={
              page.type === 'root'
                ? t(
                    'quick_menu_placeholder',
                    'Search actions, pages and channels...'
                  )
                : t('quick_menu_filter', 'Filter...')
            }
            autoComplete="off"
            spellCheck={false}
            className="flex-1 min-w-0 h-full bg-transparent outline-none text-[15px] placeholder:text-textItemBlur"
          />
          <kbd className="mobile:hidden font-sans text-[11px] leading-none px-[6px] py-[4px] rounded-[5px] border border-newTableBorder text-textItemBlur">
            esc
          </kbd>
        </div>
        <div
          id={listId}
          role="listbox"
          aria-label={t('quick_menu_results', 'Results')}
          className="max-h-[min(420px,60vh)] overflow-y-auto p-[8px] scrollbar scrollbar-thumb-newTableBorder scrollbar-track-transparent"
        >
          {!flat.length && (
            <div className="py-[32px] text-center text-[14px] text-textItemBlur">
              {query
                ? t('quick_menu_no_results', 'No results for "{{query}}"', {
                    query,
                  })
                : t('quick_menu_nothing_here', 'Nothing to show here')}
            </div>
          )}
          {filtered.map((group) => (
            <div
              key={group.id}
              role="group"
              aria-labelledby={`${baseId}-group-${group.id}`}
              className="flex flex-col pb-[6px]"
            >
              <div
                id={`${baseId}-group-${group.id}`}
                className="px-[10px] pt-[8px] pb-[4px] text-[11px] font-[600] uppercase tracking-[0.04em] text-textItemBlur"
              >
                {group.label}
              </div>
              {group.items.map((item) => {
                index++;
                const current = index;
                const selected = current === active;
                return (
                  <div
                    key={item.id}
                    id={optionId(current)}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => {
                      if (!selected) {
                        setActive(current);
                      }
                    }}
                    onClick={() => execute(item)}
                    className={clsx(
                      'flex items-center gap-[12px] h-[40px] px-[10px] rounded-[8px] cursor-pointer select-none',
                      selected
                        ? 'bg-boxHover text-newTextColor'
                        : 'text-newTextColor/80'
                    )}
                  >
                    <span
                      className={clsx(
                        'flex items-center justify-center w-[20px] h-[20px] shrink-0',
                        selected ? 'text-btnPrimary' : 'text-textItemBlur'
                      )}
                    >
                      {item.icon}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[14px]">
                      {item.label}
                    </span>
                    {!!item.hint && (
                      <span className="shrink-0 text-[12px] text-textItemBlur">
                        {item.hint}
                      </span>
                    )}
                    {item.keepOpen && (
                      <svg
                        aria-hidden="true"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        className="shrink-0 text-textItemBlur rtl:rotate-180"
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mobile:hidden flex items-center gap-[16px] px-[16px] h-[36px] border-t border-newTableBorder text-[11px] text-textItemBlur">
          <span>
            <kbd className="font-sans">↑↓</kbd>{' '}
            {t('quick_menu_hint_navigate', 'to navigate')}
          </span>
          <span>
            <kbd className="font-sans">↵</kbd>{' '}
            {t('quick_menu_hint_select', 'to select')}
          </span>
          {page.type !== 'root' && (
            <span>
              <kbd className="font-sans">⌫</kbd>{' '}
              {t('quick_menu_hint_back', 'to go back')}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
