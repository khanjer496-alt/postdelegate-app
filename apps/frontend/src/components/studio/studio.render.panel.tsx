'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import {
  FINAL_RENDER_STATUSES,
  StudioRender,
  useStudioRender,
  useStudioUsage,
} from '@gitroom/frontend/components/studio/use.studio';
import { STUDIO_MAX_SECONDS } from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';

// Opens the composer with the rendered video attached, like turning an idea
// into a post
const useOpenComposer = () => {
  const t = useT();
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const { data: integrations } = useIntegrationList();

  const open = useCallback(
    async (render: StudioRender) => {
      if (!integrations?.length) {
        toaster.show(
          t(
            'studio_no_channels',
            'Connect a channel in the calendar first, then post this video.'
          ),
          'warning'
        );
        return;
      }
      const date = (await (await fetch('/posts/find-slot')).json()).date;
      modal.openModal({
        id: 'add-edit-modal',
        closeOnClickOutside: false,
        removeLayout: true,
        closeOnEscape: false,
        withCloseButton: false,
        askClose: true,
        fullScreen: true,
        classNames: {
          modal: 'w-[100%] max-w-[1400px] text-textColor',
        },
        children: (
          <AddEditModal
            allIntegrations={integrations.map((p: any) => ({ ...p }))}
            integrations={integrations}
            reopenModal={() => open(render)}
            mutate={() => {}}
            date={fromUtc(date)}
            onlyValues={[
              {
                content: '',
                image: [
                  {
                    id: render.mediaId!,
                    path: render.path!,
                    ...(render.thumbnail
                      ? { thumbnail: render.thumbnail, thumbnailTimestamp: 0 }
                      : {}),
                  },
                ],
              },
            ]}
          />
        ),
        size: '80%',
        title: ``,
      });
    },
    [integrations, modal, t]
  );

  return open;
};

const useStatusLabel = () => {
  const t = useT();
  return (render: StudioRender) =>
    ({
      queued: t('studio_status_queued', 'Waiting for its turn…'),
      rendering: t('studio_status_rendering', 'Rendering…'),
      uploading: t('studio_status_uploading', 'Saving to your media library…'),
      completed: t('studio_status_completed', 'Ready'),
      failed: t('studio_status_failed', 'Failed'),
      cancelled: t('studio_status_cancelled', 'Cancelled'),
    }[render.status]);
};

// What is left of the fair use, in a sentence
export const StudioUsageNote: FC = () => {
  const t = useT();
  const { data: usage } = useStudioUsage();
  if (!usage) {
    return null;
  }

  return (
    <div className="text-[12px] text-textItemBlur leading-[1.5]">
      {!usage.subscribed && (
        <div className="text-textColor font-[600] mb-[2px]">
          {t(
            'studio_needs_plan',
            'Studio needs an active plan. Pick one in Billing to render videos.'
          )}
        </div>
      )}
      {usage.trial && (
        <div className="text-textColor font-[600] mb-[2px]">
          {t('studio_trial_left', '{{left}} of {{total}} trial videos left', {
            left: Math.max(0, usage.trialRenders - usage.trialUsed),
            total: usage.trialRenders,
          })}
        </div>
      )}
      {t(
        'studio_fair_use',
        'Fair use: one video at a time, up to {{day}} videos a day, {{seconds}} seconds each. {{used}} rendered in the last 24 hours.',
        {
          day: usage.maxPerDay,
          seconds: usage.maxSeconds,
          used: usage.usedToday,
        }
      )}
    </div>
  );
};

export const StudioRenderPanel: FC<{
  projectId: string;
  latest?: StudioRender;
  ready: boolean;
  tooLong: boolean;
  save: () => Promise<boolean>;
  onRendered: () => void;
}> = ({ projectId, latest, ready, tooLong, save, onRendered }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const statusLabel = useStatusLabel();
  const openComposer = useOpenComposer();
  const { mutate: mutateUsage } = useStudioUsage();
  const [renderId, setRenderId] = useState(latest?.id);
  const [starting, setStarting] = useState(false);
  const { data: render, mutate } = useStudioRender(renderId);
  const active = !!render && !FINAL_RENDER_STATUSES.includes(render.status);

  useEffect(() => {
    setRenderId(latest?.id);
  }, [projectId]);

  // the media library and the project list learn about the new video once
  useEffect(() => {
    if (render?.status === 'completed') {
      onRendered();
      mutateUsage();
    }
  }, [render?.status]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      if (!(await save())) {
        return;
      }
      const response = await fetch(`/studio/projects/${projectId}/render`, {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toaster.show(
          typeof data?.message === 'string'
            ? data.message
            : Array.isArray(data?.message)
            ? data.message.join(', ')
            : t('studio_render_failed_start', 'The render could not start'),
          'warning'
        );
        return;
      }
      setRenderId(data.id);
      mutateUsage();
    } finally {
      setStarting(false);
    }
  }, [projectId, save]);

  const cancel = useCallback(async () => {
    if (!render) {
      return;
    }
    await fetch(`/studio/renders/${render.id}/cancel`, { method: 'POST' });
    mutate();
  }, [render]);

  return (
    <div className="flex flex-col gap-[12px]">
      <button
        type="button"
        disabled={!ready || tooLong || active || starting}
        onClick={start}
        className="h-[44px] px-[16px] rounded-[10px] bg-btnCta text-btnCtaText hover:bg-btnCtaHover shadow-cta font-[600] text-[15px] disabled:opacity-50 disabled:hover:bg-btnCta"
      >
        {starting
          ? t('studio_starting', 'Starting…')
          : t('studio_render', 'Render video')}
      </button>
      {tooLong && (
        <div className="text-[13px] text-red-400">
          {t(
            'studio_too_long',
            'Videos are {{seconds}} seconds at most. Trim the clip or speed it up.',
            { seconds: STUDIO_MAX_SECONDS }
          )}
        </div>
      )}
      <StudioUsageNote />

      {!!render && (
        <div
          className="flex flex-col gap-[10px] border border-newTableBorder rounded-[10px] p-[12px]"
          aria-live="polite"
        >
          <div className="flex items-center justify-between text-[14px]">
            <span className="font-[600]">{statusLabel(render)}</span>
            {active && (
              <span className="tabular-nums text-textItemBlur">
                {render.progress}%
              </span>
            )}
          </div>
          {active && (
            <>
              <div
                className="h-[6px] rounded-full bg-newBgLineColor overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={render.progress}
              >
                <div
                  className="h-full bg-btnCta transition-all"
                  style={{ width: `${Math.max(3, render.progress)}%` }}
                />
              </div>
              <button
                type="button"
                onClick={cancel}
                className="h-[36px] rounded-[8px] bg-btnSimple text-btnText text-[14px]"
              >
                {t('studio_cancel', 'Cancel')}
              </button>
            </>
          )}
          {render.status === 'failed' && !!render.error && (
            <div className="text-[13px] text-red-400">{render.error}</div>
          )}
          {render.status === 'completed' && !!render.path && (
            <>
              <video
                src={render.path}
                poster={render.thumbnail || undefined}
                controls
                playsInline
                className="w-full max-w-[180px] aspect-[9/16] rounded-[8px] bg-black self-center"
              />
              <button
                type="button"
                onClick={() => openComposer(render)}
                className="h-[40px] rounded-[8px] bg-btnPrimary text-white text-[14px] font-[600]"
              >
                {t('studio_open_composer', 'Open in composer')}
              </button>
              <Link
                href="/media"
                className="text-[13px] text-textItemBlur underline text-center"
              >
                {t('studio_in_media', 'It is also in your media library')}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
};
