'use client';

import React, {
  FC,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import {
  getTimezone,
  newDayjs,
} from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import { DatePicker } from '@gitroom/frontend/components/launches/helpers/date.picker';
import { useUppyUploader } from '@gitroom/frontend/components/media/new.uploader';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import {
  Avatar,
  StatusChip,
  errorMessage,
} from '@gitroom/frontend/components/launches/import/import.posts.modal';

const VIDEO_LIMIT = 50;
// the uploader's limit for one video
const MAX_VIDEO_SIZE = 1000 * 1024 * 1024;

type SettingField = {
  key: string;
  type: 'text' | 'select' | 'boolean' | 'number';
  required: boolean;
  options?: string[];
  maxLength?: number;
  defaultValue?: string;
};

type BulkChannel = {
  id: string;
  name: string;
  identifier: string;
  picture?: string | null;
  refreshNeeded?: boolean;
  acceptsVideo: boolean;
  // needs a setting picked in the composer, so bulk adds drafts only
  draftsOnly: boolean;
  settings: SettingField[];
};

type Settings = Record<string, any>;

type VideoItem = {
  key: string;
  file: File | null;
  name: string;
  size: number;
  duration: number | null;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  progress: number;
  error?: string;
  media?: { id: string; path: string };
  // empty: the shared caption
  caption: string;
  // this video only, by channel id
  settings: Record<string, Settings>;
};

type Issue = { field: string; message: string; hint?: string };

type PreviewPost = {
  index: number;
  mediaId: string;
  name: string;
  caption: string;
  errors: Issue[];
  channels: Array<{
    id: string;
    name: string;
    identifier: string;
    picture?: string | null;
    date: string | null;
    errors: Issue[];
  }>;
};

type Preview = {
  limit: number;
  remaining: number | null;
  needed: number;
  total: number;
  valid: number;
  invalid: number;
  posts: PreviewPost[];
};

type SkippedChannel = { id: string; name: string; error: string };

type CreateResult = {
  type: 'schedule' | 'draft';
  created: number;
  skipped: number;
  failed: number;
  limitReached: string | null;
  cappedChannels?: SkippedChannel[];
  posts: Array<{
    index: number;
    name: string;
    status: 'created' | 'skipped' | 'failed';
    error?: string;
    skippedChannels?: SkippedChannel[];
  }>;
  alreadyCreated?: boolean;
};

const useBulkVideoChannels = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/posts-bulk-videos/channels')).json();
  }, []);
  return useSWR<BulkChannel[]>('bulk-video-channels', load, {
    revalidateOnFocus: false,
  });
};

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${Math.max(0.1, bytes / 1024 / 1024).toFixed(1)} MB`;

const formatDuration = (seconds: number | null) => {
  if (seconds === null || !isFinite(seconds)) {
    return '';
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};

// the length of a video, read by the browser before it is uploaded
const readDuration = (file: File) =>
  new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(video.duration);
    video.onerror = () => done(null);
    video.src = url;
  });

// "content_posting_method" / "selfDeclaredMadeForKids" as a label
const humanize = (value: string) => {
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// the values a channel starts with: the defaults, and "off" for yes/no
export const initialSettings = (fields: SettingField[]) =>
  fields.reduce<Settings>((all, field) => {
    if (field.type === 'boolean') {
      all[field.key] = false;
    } else if (field.defaultValue !== undefined) {
      all[field.key] = field.defaultValue;
    }
    return all;
  }, {});

// empty values are left out, the network's own default applies
export const cleanSettings = (settings: Settings = {}) =>
  Object.fromEntries(
    Object.entries(settings).filter(
      ([, value]) => value !== '' && value !== undefined && value !== null
    )
  );

const inputClass =
  'h-[40px] w-full bg-newBgColorInner px-[12px] outline-none border-newTableBorder border rounded-[8px] text-[14px] focus:border-btnPrimary';

export const SettingInput: FC<{
  field: SettingField;
  value: any;
  placeholder?: string;
  onChange: (value: any) => void;
}> = ({ field, value, placeholder, onChange }) => {
  const t = useT();
  const id = useId();
  const label = (
    <>
      {humanize(field.key)}
      {field.required && (
        <span className="text-red-600 dark:text-red-400" aria-hidden="true">
          {' *'}
        </span>
      )}
    </>
  );

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-[8px] text-[14px] cursor-pointer">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="w-[16px] h-[16px]"
        />
        {label}
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={id} className="text-[13px]">
        {label}
      </label>
      {field.type === 'select' ? (
        <select
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          <option value="">
            {field.required
              ? t('bulk_videos_choose', 'Choose...')
              : t('bulk_videos_not_set', 'Not set')}
          </option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {humanize(option)}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.type === 'number' ? 'number' : 'text'}
          value={value ?? ''}
          placeholder={placeholder}
          maxLength={field.maxLength}
          onChange={(e) =>
            onChange(
              field.type === 'number' && e.target.value !== ''
                ? Number(e.target.value)
                : e.target.value
            )
          }
          className={inputClass}
        />
      )}
    </div>
  );
};

const Steps: FC<{ step: number }> = ({ step }) => {
  const t = useT();
  const steps = [
    t('bulk_videos_step_upload', 'Videos'),
    t('bulk_videos_step_channels', 'Channels and captions'),
    t('bulk_videos_step_schedule', 'Schedule'),
  ];
  return (
    <ol className="flex gap-[8px] flex-wrap text-[13px]">
      {steps.map((label, index) => (
        <li
          key={label}
          aria-current={index === step ? 'step' : undefined}
          className={clsx(
            'flex items-center gap-[6px] h-[28px] px-[10px] rounded-full border',
            index === step
              ? 'border-btnPrimary bg-boxFocused font-[600]'
              : 'border-newTableBorder text-newTextColor/60'
          )}
        >
          <span className="tabular-nums">{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
};

const Alert: FC<{ tone: 'warn' | 'error'; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <div
    role="alert"
    className={clsx(
      'rounded-[8px] p-[12px] text-[14px]',
      tone === 'error'
        ? 'bg-red-500/10 text-red-600 dark:text-red-400'
        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    )}
  >
    {children}
  </div>
);

const IssueList: FC<{ issues: Issue[]; prefix?: string }> = ({
  issues,
  prefix,
}) => (
  <ul className="flex flex-col gap-[4px]">
    {issues.map((issue, index) => (
      <li key={index} className="text-[13px]">
        <span className="text-red-600 dark:text-red-400 font-[500]">
          {prefix ? `${prefix}: ` : ''}
          {issue.message}
        </span>
        {issue.hint && (
          <span className="text-newTextColor/70"> {issue.hint}</span>
        )}
      </li>
    ))}
  </ul>
);

export const BulkVideosModal: FC<{
  onCreated: () => void;
  close: () => void;
}> = ({ onCreated, close }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const inputId = useId();
  const { data: channels, isLoading: channelsLoading } = useBulkVideoChannels();

  const [step, setStep] = useState<'upload' | 'channels' | 'schedule' | 'done'>(
    'upload'
  );
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [channelSettings, setChannelSettings] = useState<
    Record<string, Settings>
  >({});
  const [caption, setCaption] = useState('');
  const [type, setType] = useState<'schedule' | 'draft'>('schedule');
  const [mode, setMode] = useState<'slots' | 'interval'>('slots');
  const [start, setStart] = useState(() =>
    newDayjs().add(1, 'hour').startOf('hour')
  );
  const [every, setEvery] = useState(1);
  const [unit, setUnit] = useState<'hours' | 'days'>('days');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreateResult | null>(null);
  // a request that timed out may still be running on the server
  const [running, setRunning] = useState(false);
  const pending = useRef('');
  const sentKeys = useRef<string[]>([]);

  // one upload at a time, so every saved file is matched to its row
  const active = useRef<string | null>(null);
  const finishUpload = useCallback(
    (key: string | null, media?: { id: string; path: string }, err?: string) => {
      if (!key || active.current !== key) {
        return;
      }
      active.current = null;
      setVideos((prev) =>
        prev.map((video) =>
          video.key !== key
            ? video
            : media
            ? { ...video, status: 'done', progress: 1, media, file: null }
            : { ...video, status: 'failed', error: err }
        )
      );
    },
    []
  );
  const uploadFailed = t(
    'bulk_videos_upload_failed',
    'This video could not be uploaded.'
  );

  const uppy = useUppyUploader({
    allowedFileTypes: 'video/mp4',
    onUploadSuccess: (list: any[]) => {
      const media = list?.[0];
      finishUpload(
        active.current,
        media?.id && media?.path ? { id: media.id, path: media.path } : undefined,
        uploadFailed
      );
    },
    onStart: () => undefined,
    onEnd: () => undefined,
  });

  useEffect(() => {
    const progress = (_file: any, value: any) => {
      const key = active.current;
      if (!key || !value?.bytesTotal) {
        return;
      }
      setVideos((prev) =>
        prev.map((video) =>
          video.key === key
            ? { ...video, progress: value.bytesUploaded / value.bytesTotal }
            : video
        )
      );
    };
    // a failed file comes back through onUploadSuccess with nothing in it,
    // unless the uploader gave up on the whole batch
    const failed = () => {
      if (!Object.keys(uppy.getState().currentUploads || {}).length) {
        finishUpload(active.current, undefined, uploadFailed);
      }
    };
    const complete = (outcome: any) => {
      if (!outcome?.successful?.length) {
        finishUpload(active.current, undefined, uploadFailed);
      }
    };
    uppy.on('upload-progress', progress);
    uppy.on('error', failed);
    uppy.on('complete', complete);
    return () => {
      uppy.off('upload-progress', progress);
      uppy.off('error', failed);
      uppy.off('complete', complete);
    };
  }, [uppy]);

  // closing the window stops the upload that is running
  useEffect(
    () => () => {
      if (active.current) {
        uppy.cancelAll();
        useLaunchStore.getState().setLocked(false);
      }
    },
    [uppy]
  );

  useEffect(() => {
    if (active.current) {
      return;
    }
    const next = videos.find((video) => video.status === 'queued');
    if (!next?.file) {
      return;
    }
    active.current = next.key;
    setVideos((prev) =>
      prev.map((video) =>
        video.key === next.key ? { ...video, status: 'uploading' } : video
      )
    );
    try {
      uppy.addFile(next.file as any);
    } catch (err: any) {
      finishUpload(next.key, undefined, err?.message || uploadFailed);
    }
  }, [videos]);

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = VIDEO_LIMIT - videos.length;
      if (files.length > room) {
        toaster.show(
          t(
            'bulk_videos_too_many',
            'You can schedule up to {{limit}} videos at a time.',
            { limit: VIDEO_LIMIT }
          ),
          'warning'
        );
      }
      const added: VideoItem[] = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        const isVideo = file.type.startsWith('video/');
        const tooBig = file.size > MAX_VIDEO_SIZE;
        added.push({
          key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
          file,
          name: file.name,
          size: file.size,
          duration: isVideo ? await readDuration(file) : null,
          status: isVideo && !tooBig ? 'queued' : 'failed',
          progress: 0,
          error: !isVideo
            ? t('bulk_videos_not_video', 'This is not a video file.')
            : tooBig
            ? t(
                'bulk_videos_too_big',
                'This video is larger than 1 GB.'
              )
            : undefined,
          caption: '',
          settings: {},
        });
      }
      // two drops in a row can both be reading durations, the cap is
      // checked against the list as it is when they land
      setVideos((prev) => [
        ...prev,
        ...added.slice(0, Math.max(0, VIDEO_LIMIT - prev.length)),
      ]);
    },
    [videos.length]
  );

  const removeVideo = useCallback(
    (key: string) => () => {
      setVideos((prev) => prev.filter((video) => video.key !== key));
    },
    []
  );

  const updateVideo = useCallback(
    (key: string, change: (video: VideoItem) => VideoItem) => {
      setVideos((prev) =>
        prev.map((video) => (video.key === key ? change(video) : video))
      );
    },
    []
  );

  const videoChannels = useMemo(
    () => (channels || []).filter((channel) => channel.acceptsVideo),
    [channels]
  );
  const hiddenChannels = (channels || []).length - videoChannels.length;
  const selectedChannels = useMemo(
    () => videoChannels.filter((channel) => selected.includes(channel.id)),
    [videoChannels, selected]
  );

  const toggleChannel = useCallback(
    (channel: BulkChannel) => () => {
      setSelected((prev) =>
        prev.includes(channel.id)
          ? prev.filter((id) => id !== channel.id)
          : [...prev, channel.id]
      );
      setChannelSettings((prev) =>
        prev[channel.id]
          ? prev
          : { ...prev, [channel.id]: initialSettings(channel.settings) }
      );
    },
    []
  );

  // a network that needs a setting picked in the composer gets drafts only
  const draftsOnly = selectedChannels.filter((channel) => channel.draftsOnly);
  useEffect(() => {
    if (draftsOnly.length && type === 'schedule') {
      setType('draft');
    }
  }, [draftsOnly.length, type]);

  const ready = useMemo(
    () => videos.filter((video) => video.status === 'done' && video.media),
    [videos]
  );
  const uploading = videos.some(
    (video) => video.status === 'queued' || video.status === 'uploading'
  );

  const body = useMemo(
    () => ({
      type,
      schedule: {
        mode,
        start: start.toISOString(),
        ...(mode === 'interval' ? { every, unit } : {}),
        timezone: getTimezone(),
      },
      ...(caption.trim() ? { caption } : {}),
      channels: selectedChannels.map((channel) => ({
        id: channel.id,
        settings: cleanSettings(channelSettings[channel.id]),
      })),
      videos: ready.map((video) => {
        const settings = Object.fromEntries(
          Object.entries(video.settings)
            .filter(([id]) => selected.includes(id))
            .map(([id, value]) => [id, cleanSettings(value)])
            .filter(([, value]) => Object.keys(value).length)
        );
        return {
          mediaId: video.media!.id,
          ...(video.caption.trim() ? { caption: video.caption } : {}),
          ...(Object.keys(settings).length ? { settings } : {}),
        };
      }),
    }),
    [
      type,
      mode,
      start,
      every,
      unit,
      caption,
      selectedChannels,
      channelSettings,
      ready,
      selected,
    ]
  );
  const bodyKey = useMemo(() => JSON.stringify(body), [body]);
  const fresh = !!preview && previewKey === bodyKey;

  const checkPreview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/posts-bulk-videos/preview', {
        method: 'POST',
        body: bodyKey,
      });
      if (!response.ok) {
        setError(
          await errorMessage(
            response,
            t('bulk_videos_preview_failed', 'We could not check these videos.')
          )
        );
        return;
      }
      setPreview(await response.json());
      setPreviewKey(bodyKey);
    } catch (err) {
      setError(
        t('bulk_videos_preview_failed', 'We could not check these videos.')
      );
    } finally {
      setLoading(false);
    }
  }, [bodyKey]);

  useEffect(() => {
    if (step === 'schedule' && !preview) {
      checkPreview();
    }
  }, [step]);

  // the request to create: the preview's dates go with it, so the posts
  // land where the preview showed them while those times are still free
  const createKey = useMemo(() => {
    if (!preview || !fresh) {
      return '';
    }
    return JSON.stringify({
      ...body,
      videos: body.videos.map((video, index) => ({
        ...video,
        dates: Object.fromEntries(
          (preview.posts[index]?.channels || [])
            .filter((channel) => channel.date)
            .map((channel) => [channel.id, channel.date])
        ),
      })),
    });
  }, [body, preview, fresh]);

  const showResult = useCallback(
    (data: CreateResult) => {
      setResult(data);
      setStep('done');
      if (data.created) {
        onCreated();
      }
    },
    [onCreated]
  );

  // Where a request stands on the server. The first call sends the body and
  // gets its key back, the next ones only send the key
  const statusKey = useRef('');
  const readStatus = useCallback(
    async (
      payload: string
    ): Promise<{ status: string; result?: CreateResult } | null> => {
      try {
        const response = statusKey.current
          ? await fetch(`/posts-bulk-videos/status/${statusKey.current}`)
          : await fetch('/posts-bulk-videos/status', {
              method: 'POST',
              body: payload,
            });
        if (!response.ok) {
          return null;
        }
        const data = await response.json();
        if (data?.key) {
          statusKey.current = data.key;
        }
        return data;
      } catch (err) {
        return null;
      }
    },
    []
  );

  // The create request. A timeout, a gateway error or a 409 may leave it
  // running on the server: 'running' then follows it through the status
  const send = useCallback(
    async (payload: string): Promise<'done' | 'running' | 'error'> => {
      let response: Response;
      try {
        response = await fetch('/posts-bulk-videos', {
          method: 'POST',
          body: payload,
        });
      } catch (err) {
        return 'running';
      }
      if (response.status === 409) {
        return 'running';
      }
      if (response.status >= 500) {
        // an error of the app itself says what went wrong, a gateway's doesn't
        const body = await response
          .clone()
          .json()
          .catch(() => null);
        if (!body?.message) {
          return 'running';
        }
        // the posts may have gone in before the error
        const status = await readStatus(payload);
        if (status?.status === 'done' && status.result) {
          pending.current = '';
          showResult(status.result);
          return 'done';
        }
        if (status?.status === 'running') {
          return 'running';
        }
      }
      if (!response.ok) {
        // a 402 (plan limit) is handled by the app already
        if (response.status !== 402) {
          setError(
            await errorMessage(
              response,
              t('bulk_videos_failed', 'The videos were not scheduled.')
            )
          );
        }
        // the dates may have moved on, the preview has to be checked again
        setPreviewKey('');
        pending.current = '';
        return 'error';
      }
      // a status check that may be running stops here
      pending.current = '';
      showResult(await response.json());
      return 'done';
    },
    [showResult, readStatus]
  );

  // Follows a request that may still be running, now and then every 5
  // seconds. "none" is only final once the create request itself answered
  // (or after a minute: "Move to billing" never answers it). Still running
  // after 15 minutes, past the time a stopped run is taken over, the create
  // is sent once more so a crashed run resumes. It gives up at 20 minutes.
  const follow = useCallback(
    async (payload: string, answered: () => boolean) => {
      setRunning(true);
      const started = Date.now();
      let resent = false;
      while (pending.current === payload) {
        const waited = Date.now() - started;
        if (waited > 20 * 60 * 1000) {
          setError(
            t(
              'bulk_videos_too_long',
              'This is taking longer than expected. Check the calendar before you schedule these videos again.'
            )
          );
          setPreviewKey('');
          return;
        }
        const status = await readStatus(payload);
        if (pending.current !== payload) {
          return;
        }
        if (status?.status === 'done' && status.result) {
          showResult(status.result);
          return;
        }
        if (
          status?.status === 'none' &&
          (answered() || waited > 60 * 1000)
        ) {
          setError(
            t(
              'bulk_videos_not_created',
              'The videos were not scheduled. Check the preview, then try again.'
            )
          );
          setPreviewKey('');
          return;
        }
        if (status?.status === 'running' && !resent && waited > 15.5 * 60 * 1000) {
          resent = true;
          // answers with the result when it resumes, or 409 while it runs
          send(payload);
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    },
    [showResult, readStatus, send]
  );

  const create = useCallback(async () => {
    if (!createKey) {
      return;
    }
    setLoading(true);
    setError('');
    sentKeys.current = ready.map((video) => video.key);
    pending.current = createKey;
    statusKey.current = '';
    // "Move to billing" in the payment dialog never answers the request:
    // coming back to the page while it is still waiting follows the status
    let hidden = false;
    let onVisible = () => undefined as void;
    const back = new Promise<'running'>((resolve) => {
      onVisible = () => {
        if (document.visibilityState === 'hidden') {
          hidden = true;
        } else if (hidden) {
          resolve('running');
        }
      };
      document.addEventListener('visibilitychange', onVisible);
    });
    let answered = false;
    const request = send(createKey).finally(() => {
      answered = true;
    });
    const outcome = await Promise.race([request, back]);
    document.removeEventListener('visibilitychange', onVisible);
    if (outcome === 'running') {
      await follow(createKey, () => answered);
    }
    pending.current = '';
    setRunning(false);
    setLoading(false);
  }, [createKey, ready, send, follow]);

  // closing the window stops checking, the server finishes on its own
  useEffect(
    () => () => {
      pending.current = '';
    },
    []
  );

  // back to the videos that were not created, as a new request
  const scheduleRest = useCallback(() => {
    const created = new Set(
      (result?.posts || [])
        .filter((post) => post.status === 'created')
        .map((post) => sentKeys.current[post.index])
    );
    setVideos((prev) => prev.filter((video) => !created.has(video.key)));
    setPreview(null);
    setResult(null);
    setStep('schedule');
  }, [result]);

  const dateFormat = isUSCitizen()
    ? 'ddd, MMM D, YYYY hh:mm A'
    : 'ddd, D MMM YYYY, HH:mm';
  const stepIndex = { upload: 0, channels: 1, schedule: 2, done: 2 }[step];

  return (
    <div className="flex flex-col gap-[20px] whitespace-normal w-[820px] max-w-full">
      {step !== 'done' && <Steps step={stepIndex} />}

      {step === 'upload' && (
        <>
          <p className="text-[14px] text-newTextColor/70">
            {t(
              'bulk_videos_intro',
              'Add up to {{limit}} videos. Each video becomes one post on the channels you pick, spread over your posting times.',
              { limit: VIDEO_LIMIT }
            )}
          </p>
          <label
            htmlFor={`${inputId}-file`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(Array.from(e.dataTransfer.files || []));
            }}
            className={clsx(
              'flex flex-col items-center justify-center gap-[6px] min-h-[140px] p-[20px] rounded-[12px] border-2 border-dashed cursor-pointer text-center transition-colors focus-within:border-btnPrimary',
              dragging
                ? 'border-btnPrimary bg-boxFocused'
                : 'border-newTableBorder hover:border-btnPrimary',
              videos.length >= VIDEO_LIMIT && 'opacity-60 pointer-events-none'
            )}
          >
            <input
              id={`${inputId}-file`}
              type="file"
              accept="video/mp4,video/quicktime"
              multiple={true}
              className="sr-only"
              disabled={videos.length >= VIDEO_LIMIT}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                addFiles(files);
              }}
            />
            <span className="text-[15px] font-[600]">
              {t('bulk_videos_choose_files', 'Choose videos or drop them here')}
            </span>
            <span className="text-[12px] text-newTextColor/60">
              {t(
                'bulk_videos_file_limit',
                'MP4, up to 1 GB each. They are saved to your media library.'
              )}
            </span>
          </label>

          {!!videos.length && (
            <ul
              className="flex flex-col gap-[8px] max-h-[40vh] overflow-y-auto pe-[4px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor"
              aria-label={t('bulk_videos_list', 'Videos')}
            >
              {videos.map((video) => (
                <li
                  key={video.key}
                  className={clsx(
                    'flex items-center gap-[12px] p-[12px] rounded-[10px] border',
                    video.status === 'failed'
                      ? 'border-red-500/40 bg-red-500/5'
                      : 'border-newTableBorder bg-newBgColor'
                  )}
                >
                  <div className="flex-1 min-w-0 flex flex-col gap-[4px]">
                    <div className="text-[14px] font-[500] truncate">
                      {video.name}
                    </div>
                    <div className="text-[12px] text-newTextColor/60 tabular-nums flex gap-[8px]">
                      {!!formatDuration(video.duration) && (
                        <span>{formatDuration(video.duration)}</span>
                      )}
                      <span>{formatSize(video.size)}</span>
                      {video.status === 'uploading' && (
                        <span>
                          {video.progress >= 1
                            ? t('processing', 'Processing...')
                            : `${Math.round(video.progress * 100)}%`}
                        </span>
                      )}
                      {video.status === 'queued' && (
                        <span>{t('bulk_videos_waiting', 'Waiting')}</span>
                      )}
                    </div>
                    {video.status === 'uploading' && (
                      <div
                        className="h-[4px] rounded-full bg-newTableBorder overflow-hidden"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(video.progress * 100)}
                      >
                        <div
                          className="h-full bg-btnPrimary transition-[width]"
                          style={{ width: `${Math.round(video.progress * 100)}%` }}
                        />
                      </div>
                    )}
                    {video.status === 'failed' && !!video.error && (
                      <div className="text-[13px] text-red-600 dark:text-red-400">
                        {video.error}
                      </div>
                    )}
                  </div>
                  {video.status === 'done' && (
                    <StatusChip tone="ok">
                      {t('bulk_videos_uploaded', 'Uploaded')}
                    </StatusChip>
                  )}
                  <button
                    type="button"
                    onClick={removeVideo(video.key)}
                    disabled={video.status === 'uploading'}
                    aria-label={t('bulk_videos_remove', 'Remove {{name}}', {
                      name: video.name,
                    })}
                    className="h-[32px] px-[10px] rounded-[8px] bg-btnSimple text-btnText text-[13px] disabled:opacity-40"
                  >
                    {t('remove', 'Remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-[10px] items-center justify-end">
            <span className="text-[13px] text-newTextColor/60 me-auto">
              {t('bulk_videos_count', '{{count}} of {{limit}} videos', {
                count: videos.length,
                limit: VIDEO_LIMIT,
              })}
            </span>
            <Button
              type="button"
              onClick={() => setStep('channels')}
              disabled={!ready.length || uploading}
              className="rounded-[8px]"
            >
              {uploading
                ? t('bulk_videos_uploading', 'Uploading...')
                : t('next', 'Next')}
            </Button>
          </div>
        </>
      )}

      {step === 'channels' && (
        <>
          <div className="flex flex-col gap-[10px]">
            <div className="text-[14px] font-[600]">
              {t('bulk_videos_pick_channels', 'Post the videos to')}
            </div>
            {channelsLoading && (
              <div className="text-[14px] text-newTextColor/60">
                {t('loading', 'Loading...')}
              </div>
            )}
            {!channelsLoading && !videoChannels.length && (
              <Alert tone="warn">
                {t(
                  'bulk_videos_no_channels',
                  'None of your channels can post a video. Connect a channel like YouTube, TikTok or Instagram first.'
                )}
              </Alert>
            )}
            <ul className="flex flex-wrap gap-[8px]">
              {videoChannels.map((channel) => (
                <li key={channel.id}>
                  <button
                    type="button"
                    onClick={toggleChannel(channel)}
                    aria-pressed={selected.includes(channel.id)}
                    className={clsx(
                      'flex items-center gap-[8px] h-[40px] px-[12px] rounded-[8px] border text-[14px] transition-colors',
                      selected.includes(channel.id)
                        ? 'border-btnPrimary bg-boxFocused'
                        : 'border-newTableBorder bg-newBgColor hover:bg-boxHover'
                    )}
                  >
                    <Avatar
                      picture={channel.picture}
                      identifier={channel.identifier}
                      name={channel.name}
                    />
                    {channel.name}
                    {channel.draftsOnly && (
                      <span className="text-[12px] text-newTextColor/60">
                        {t('bulk_videos_drafts_only', 'Drafts only')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {!!draftsOnly.length && (
              <Alert tone="warn">
                {t(
                  'bulk_videos_drafts_only_note',
                  '{{names}} need a setting picked in the composer, like a board or a channel, so the videos are added as drafts. Finish them in the composer to schedule them.',
                  { names: draftsOnly.map((channel) => channel.name).join(', ') }
                )}
              </Alert>
            )}
            {hiddenChannels > 0 && (
              <div className="text-[12px] text-newTextColor/60">
                {t(
                  'bulk_videos_hidden_channels',
                  'Channels that cannot post a video are not shown.'
                )}
              </div>
            )}
          </div>

          {selectedChannels
            .filter((channel) => channel.settings.length)
            .map((channel) => (
              <fieldset
                key={channel.id}
                className="flex flex-col gap-[12px] p-[12px] rounded-[10px] border border-newTableBorder"
              >
                <legend className="px-[6px] text-[14px] font-[600] flex items-center gap-[8px]">
                  <Avatar
                    picture={channel.picture}
                    identifier={channel.identifier}
                    name={channel.name}
                  />
                  {t('bulk_videos_settings_for', '{{name}} settings', {
                    name: channel.name,
                  })}
                </legend>
                {channel.refreshNeeded && (
                  <Alert tone="warn">
                    {t(
                      'bulk_videos_refresh_needed',
                      'This channel needs to be reconnected before the posts go out.'
                    )}
                  </Alert>
                )}
                <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[12px]">
                  {channel.settings.map((field) => (
                    <SettingInput
                      key={field.key}
                      field={field}
                      value={channelSettings[channel.id]?.[field.key]}
                      onChange={(value) =>
                        setChannelSettings((prev) => ({
                          ...prev,
                          [channel.id]: { ...prev[channel.id], [field.key]: value },
                        }))
                      }
                    />
                  ))}
                </div>
                <div className="text-[12px] text-newTextColor/60">
                  {t(
                    'bulk_videos_settings_note',
                    'These settings go to every video. {filename} is replaced by the name of each video. Settings picked from a list on the network, like a board or a server channel, are set in the composer.'
                  )}
                </div>
              </fieldset>
            ))}

          <div className="flex flex-col gap-[6px]">
            <label htmlFor={`${inputId}-caption`} className="text-[14px] font-[600]">
              {t('bulk_videos_caption', 'Caption')}
            </label>
            <textarea
              id={`${inputId}-caption`}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              placeholder={t(
                'bulk_videos_caption_placeholder',
                'Optional. The same text for every video, like: New video: {filename}'
              )}
              className="w-full bg-newBgColorInner p-[12px] outline-none border-newTableBorder border rounded-[8px] text-[14px] focus:border-btnPrimary"
            />
            <div className="text-[12px] text-newTextColor/60">
              {t(
                'bulk_videos_caption_note',
                '{filename} is replaced by the name of each video. Give a video its own caption below.'
              )}
            </div>
          </div>

          <ul
            className="flex flex-col gap-[8px] max-h-[35vh] overflow-y-auto pe-[4px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor"
            aria-label={t('bulk_videos_captions', 'Captions of the videos')}
          >
            {ready.map((video) => (
              <li key={video.key} className="flex flex-col gap-[6px]">
                <div className="text-[13px] font-[500] truncate">{video.name}</div>
                <textarea
                  aria-label={t('bulk_videos_caption_of', 'Caption of {{name}}', {
                    name: video.name,
                  })}
                  value={video.caption}
                  onChange={(e) =>
                    updateVideo(video.key, (prev) => ({
                      ...prev,
                      caption: e.target.value,
                    }))
                  }
                  rows={2}
                  placeholder={
                    caption ||
                    t('bulk_videos_no_caption', 'No caption')
                  }
                  className="w-full bg-newBgColorInner p-[10px] outline-none border-newTableBorder border rounded-[8px] text-[13px] focus:border-btnPrimary"
                />
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-[10px] items-center justify-between">
            <button
              type="button"
              onClick={() => setStep('upload')}
              className="h-[40px] px-[16px] rounded-[8px] bg-btnSimple text-btnText text-[14px] font-[500]"
            >
              {t('back', 'Back')}
            </button>
            <Button
              type="button"
              onClick={() => setStep('schedule')}
              disabled={!selectedChannels.length}
              className="rounded-[8px]"
            >
              {t('next', 'Next')}
            </Button>
          </div>
        </>
      )}

      {step === 'schedule' && (
        <>
          {/* nothing changes while the videos are being created */}
          <fieldset
            disabled={loading}
            aria-busy={loading}
            className={clsx(
              'flex flex-col gap-[20px] min-w-0',
              loading && 'pointer-events-none opacity-70'
            )}
          >
          <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[16px]">
            <fieldset className="flex flex-col gap-[8px]">
              <legend className="text-[14px] font-[600] mb-[8px]">
                {t('bulk_videos_how', 'How to spread them')}
              </legend>
              <label className="flex items-start gap-[8px] text-[14px] cursor-pointer">
                <input
                  type="radio"
                  name={`${inputId}-mode`}
                  checked={mode === 'slots'}
                  onChange={() => setMode('slots')}
                  className="mt-[3px]"
                />
                <span>
                  {t('bulk_videos_mode_slots', 'Next free time slots')}
                  <span className="block text-[12px] text-newTextColor/60">
                    {t(
                      'bulk_videos_mode_slots_note',
                      "Each channel's time slots in order, skipping the ones that already have a post."
                    )}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-[8px] text-[14px] cursor-pointer">
                <input
                  type="radio"
                  name={`${inputId}-mode`}
                  checked={mode === 'interval'}
                  onChange={() => setMode('interval')}
                  className="mt-[3px]"
                />
                <span>{t('bulk_videos_mode_interval', 'One every few hours or days')}</span>
              </label>
              {mode === 'interval' && (
                <div className="flex items-center gap-[8px] ps-[24px] text-[14px]">
                  <span>{t('bulk_videos_every', 'Every')}</span>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={every}
                    aria-label={t('bulk_videos_every_amount', 'How many')}
                    onChange={(e) =>
                      setEvery(Math.min(720, Math.max(1, Number(e.target.value) || 1)))
                    }
                    className={clsx(inputClass, '!w-[80px]')}
                  />
                  <select
                    value={unit}
                    aria-label={t('bulk_videos_every_unit', 'Hours or days')}
                    onChange={(e) => setUnit(e.target.value as 'hours' | 'days')}
                    className={clsx(inputClass, '!w-[110px]')}
                  >
                    <option value="hours">{t('bulk_videos_hours', 'hours')}</option>
                    <option value="days">{t('bulk_videos_days', 'days')}</option>
                  </select>
                </div>
              )}
            </fieldset>

            <div className="flex flex-col gap-[8px]">
              <div className="text-[14px] font-[600]">
                {mode === 'slots'
                  ? t('bulk_videos_start_from', 'Starting from')
                  : t('bulk_videos_first_post', 'First post')}
              </div>
              <div className="flex">
                <DatePicker date={start} onChange={setStart} />
              </div>
              <fieldset className="flex flex-col gap-[8px] mt-[8px]">
                <legend className="sr-only">
                  {t('bulk_videos_save_as', 'Save as')}
                </legend>
                <label
                  className={clsx(
                    'flex items-center gap-[8px] text-[14px] cursor-pointer',
                    !!draftsOnly.length && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <input
                    type="radio"
                    name={`${inputId}-type`}
                    checked={type === 'schedule'}
                    disabled={!!draftsOnly.length}
                    onChange={() => setType('schedule')}
                  />
                  {t('bulk_videos_type_schedule', 'Schedule them')}
                </label>
                <label className="flex items-center gap-[8px] text-[14px] cursor-pointer">
                  <input
                    type="radio"
                    name={`${inputId}-type`}
                    checked={type === 'draft'}
                    onChange={() => setType('draft')}
                  />
                  {t('bulk_videos_type_draft', 'Add them as drafts')}
                </label>
                {!!draftsOnly.length && (
                  <span className="text-[12px] text-newTextColor/60">
                    {t(
                      'bulk_videos_drafts_only_short',
                      '{{names}}: drafts only, finish them in the composer.',
                      { names: draftsOnly.map((channel) => channel.name).join(', ') }
                    )}
                  </span>
                )}
              </fieldset>
            </div>
          </div>

          {!!error && <Alert tone="error">{error}</Alert>}

          {preview && (
            <div className="flex flex-col gap-[10px]">
              <div className="flex items-center gap-[10px] flex-wrap">
                <div className="text-[16px] font-[600]" aria-live="polite">
                  {t('bulk_videos_summary', '{{valid}} of {{total}} videos are ready', {
                    valid: preview.valid,
                    total: preview.total,
                  })}
                  {preview.invalid > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {' · '}
                      {t('bulk_videos_problems', '{{count}} need a fix', {
                        count: preview.invalid,
                      })}
                    </span>
                  )}
                </div>
                {!fresh && (
                  <span className="text-[13px] text-amber-600 dark:text-amber-400">
                    {t('bulk_videos_stale', 'You changed something, check again.')}
                  </span>
                )}
              </div>
              {preview.remaining !== null && preview.needed > preview.remaining && (
                <Alert tone="warn">
                  {t(
                    'bulk_videos_limit_note',
                    'Your plan has {{remaining}} posts left this month and this needs {{needed}} (every channel of a video is a post). The videos past the limit are not created.',
                    { remaining: preview.remaining, needed: preview.needed }
                  )}
                </Alert>
              )}
              <ul
                className="flex flex-col gap-[8px] max-h-[40vh] overflow-y-auto pe-[4px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor"
                aria-label={t('bulk_videos_preview', 'Preview')}
              >
                {preview.posts.map((post) => {
                  const video = ready.find(
                    (item) => item.media?.id === post.mediaId
                  );
                  const problems =
                    !!post.errors.length ||
                    post.channels.some((channel) => channel.errors.length);
                  return (
                    <li
                      key={post.index}
                      className={clsx(
                        'flex flex-col gap-[8px] p-[12px] rounded-[10px] border',
                        problems
                          ? 'border-red-500/40 bg-red-500/5'
                          : 'border-newTableBorder bg-newBgColor'
                      )}
                    >
                      <div className="flex items-center gap-[10px]">
                        <span className="text-[14px] font-[500] truncate flex-1 min-w-0">
                          {post.name}
                        </span>
                        <StatusChip tone={problems ? 'error' : 'ok'}>
                          {problems
                            ? t('import_needs_fix', 'Needs a fix')
                            : t('import_ready', 'Ready')}
                        </StatusChip>
                      </div>
                      <ul className="flex flex-col gap-[4px]">
                        {post.channels.map((channel) => (
                          <li
                            key={channel.id}
                            className="flex items-center gap-[8px] text-[13px] tabular-nums"
                          >
                            <Avatar
                              picture={channel.picture}
                              identifier={channel.identifier}
                              name={channel.name}
                            />
                            {channel.date
                              ? newDayjs(channel.date).format(dateFormat)
                              : t('bulk_videos_no_date', 'No date')}
                          </li>
                        ))}
                      </ul>
                      {!!post.caption && (
                        <div className="text-[13px] line-clamp-2 break-words whitespace-pre-line text-newTextColor/80">
                          {post.caption}
                        </div>
                      )}
                      <IssueList issues={post.errors} />
                      {post.channels
                        .filter((channel) => channel.errors.length)
                        .map((channel) => (
                          <IssueList
                            key={channel.id}
                            issues={channel.errors}
                            prefix={channel.name}
                          />
                        ))}
                      {problems && video && (
                        <div className="flex flex-col gap-[10px] pt-[8px] border-t border-newTableBorder">
                          <textarea
                            aria-label={t('bulk_videos_caption_of', 'Caption of {{name}}', {
                              name: video.name,
                            })}
                            value={video.caption}
                            onChange={(e) =>
                              updateVideo(video.key, (prev) => ({
                                ...prev,
                                caption: e.target.value,
                              }))
                            }
                            rows={2}
                            placeholder={
                              caption || t('bulk_videos_no_caption', 'No caption')
                            }
                            className="w-full bg-newBgColorInner p-[10px] outline-none border-newTableBorder border rounded-[8px] text-[13px] focus:border-btnPrimary"
                          />
                          {post.channels
                            .filter((channel) => channel.errors.length)
                            .map((channel) => {
                              const fields = (
                                selectedChannels.find((p) => p.id === channel.id)
                                  ?.settings || []
                              ).filter((field) => field.type === 'text');
                              if (!fields.length) {
                                return null;
                              }
                              return (
                                <div
                                  key={channel.id}
                                  className="grid grid-cols-2 mobile:grid-cols-1 gap-[10px]"
                                >
                                  {fields.map((field) => (
                                    <SettingInput
                                      key={field.key}
                                      field={{ ...field, required: false }}
                                      value={video.settings[channel.id]?.[field.key]}
                                      placeholder={
                                        channelSettings[channel.id]?.[field.key] || ''
                                      }
                                      onChange={(value) =>
                                        updateVideo(video.key, (prev) => ({
                                          ...prev,
                                          settings: {
                                            ...prev.settings,
                                            [channel.id]: {
                                              ...prev.settings[channel.id],
                                              [field.key]: value,
                                            },
                                          },
                                        }))
                                      }
                                    />
                                  ))}
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          </fieldset>

          {running && (
            <Alert tone="warn">
              {t(
                'bulk_videos_still_running',
                'This may still be running. We are checking every few seconds, so don\'t send it again. The result shows here when it is done.'
              )}
            </Alert>
          )}

          <div className="flex flex-wrap gap-[10px] items-center justify-between">
            <button
              type="button"
              onClick={() => setStep('channels')}
              disabled={loading}
              className="h-[40px] px-[16px] rounded-[8px] bg-btnSimple text-btnText text-[14px] font-[500] disabled:opacity-50"
            >
              {t('back', 'Back')}
            </button>
            <div className="flex items-center gap-[10px] ms-auto flex-wrap justify-end">
              <button
                type="button"
                onClick={checkPreview}
                disabled={loading || fresh}
                className="h-[40px] px-[16px] rounded-[8px] bg-btnSimple text-btnText text-[14px] font-[500] disabled:opacity-50"
              >
                {preview
                  ? t('bulk_videos_check_again', 'Check again')
                  : t('bulk_videos_show_preview', 'Show preview')}
              </button>
              <Button
                type="button"
                onClick={create}
                loading={loading}
                disabled={
                  !createKey ||
                  !preview?.total ||
                  preview.valid !== preview.total
                }
                className="rounded-[8px]"
              >
                {type === 'draft'
                  ? t('bulk_videos_create_drafts', 'Add {{count}} drafts', {
                      count: ready.length,
                    })
                  : t('bulk_videos_create', 'Schedule {{count}} videos', {
                      count: ready.length,
                    })}
              </Button>
            </div>
          </div>
        </>
      )}

      {step === 'done' && result && (
        <>
          <div className="flex flex-col gap-[8px]" aria-live="polite">
            <div className="text-[18px] font-[600]">
              {result.alreadyCreated
                ? t(
                    'bulk_videos_already_done',
                    'These videos were already scheduled, nothing new was added.'
                  )
                : result.type === 'draft'
                ? t('bulk_videos_created_drafts', '{{count}} videos were added as drafts', {
                    count: result.created,
                  })
                : t('bulk_videos_created', '{{count}} videos are scheduled', {
                    count: result.created,
                  })}
            </div>
            {!!result.limitReached && (
              <Alert tone="warn">
                {result.limitReached}{' '}
                {t(
                  'bulk_videos_limit_stopped',
                  '{{count}} videos were not created.',
                  { count: result.skipped }
                )}
              </Alert>
            )}
            {!!result.cappedChannels?.length && (
              <Alert tone="warn">
                {t(
                  'bulk_videos_capped',
                  'A monthly limit of your plan stopped {{names}}, so those posts were skipped. The other channels got their videos.',
                  {
                    names: result.cappedChannels
                      .map((channel) => channel.name)
                      .join(', '),
                  }
                )}{' '}
                {result.cappedChannels[0].error}
              </Alert>
            )}
            {result.failed > 0 && (
              <div className="text-[14px] text-newTextColor/70">
                {t('bulk_videos_failed_count', '{{count}} could not be created.', {
                  count: result.failed,
                })}
              </div>
            )}
          </div>
          {result.posts.some(
            (post) => post.status !== 'created' || post.skippedChannels?.length
          ) && (
            <ul className="flex flex-col gap-[6px] max-h-[40vh] overflow-y-auto text-[13px]">
              {result.posts
                .filter(
                  (post) =>
                    post.status !== 'created' || post.skippedChannels?.length
                )
                .map((post) => (
                  <li key={post.index} className="flex gap-[8px]">
                    <span className="font-[600] shrink-0 max-w-[40%] truncate">
                      {post.name}
                    </span>
                    <span className="text-red-600 dark:text-red-400">
                      {post.status === 'created'
                        ? t('bulk_videos_not_posted_to', 'Not posted to {{names}}.', {
                            names: (post.skippedChannels || [])
                              .map((channel) => channel.name)
                              .join(', '),
                          })
                        : post.error}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          <div className="flex justify-end gap-[10px] flex-wrap">
            {!result.alreadyCreated &&
              result.posts.some((post) => post.status !== 'created') && (
                <button
                  type="button"
                  onClick={scheduleRest}
                  className="h-[40px] px-[16px] rounded-[8px] bg-btnSimple text-btnText text-[14px] font-[500]"
                >
                  {t('bulk_videos_rest', 'Try the rest again')}
                </button>
              )}
            <Button type="button" onClick={close} className="rounded-[8px]">
              {t('done', 'Done')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
