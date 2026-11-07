'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { StudioWord } from '@gitroom/helpers/utils/studio.captions';
import type { StudioTextStyle } from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import type { ChannelState } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';

export type StudioPosition = 'top' | 'center' | 'bottom';

export type StudioTemplate = {
  identifier: string;
  title: string;
  description: string;
  captions: boolean;
  // runs on the workspace's own AI key
  ai?: boolean;
};

// What the workspace's own AI can do in Studio
export type StudioAi = {
  connected: boolean;
  provider?: string;
  voices: string[];
  video: boolean;
};

export type StudioAiScript = {
  hook: string;
  lines: string[];
  cta?: string;
  postText?: string;
};

export type StudioUsage = {
  maxSeconds: number;
  maxQueuedPerWorkspace: number;
  maxQueuedGlobal: number;
  maxPerDay: number;
  trialRenders: number;
  subscribed: boolean;
  trial: boolean;
  usedToday: number;
  trialUsed: number;
};

export type StudioRender = {
  id: string;
  projectId: string;
  status:
    | 'queued'
    | 'generating'
    | 'rendering'
    | 'uploading'
    | 'completed'
    | 'failed'
    | 'cancelled';
  progress: number;
  seconds: number;
  error: string | null;
  mediaId: string | null;
  path: string | null;
  thumbnail: string | null;
  createdAt: string;
};

export type StudioFocus = { x: number; y: number };

// Music uploaded with POST /studio/assets
export type StudioMusic = {
  assetId: string;
  name?: string;
  path?: string;
  start?: number;
  volume?: number;
};

// A picture or video of the media library in the templates made of several
export type StudioMediaItem = {
  mediaId: string;
  path?: string;
  focus?: StudioFocus;
};

export type StudioSlide = StudioMediaItem & { text?: string; seconds: number };
export type StudioCompareSide = StudioMediaItem & {
  label?: string;
  start?: number;
};
export type StudioListItem = StudioMediaItem & {
  label: string;
  trim?: { start: number; end: number };
  seconds?: number;
};

// What the editor keeps for every template; each template reads its part
export type StudioSpec = {
  input?: { mediaId: string; path?: string };
  trim?: { start: number; end: number };
  speed?: 0.5 | 1 | 1.5 | 2;
  mute?: boolean;
  focus?: { x: number; y: number };
  fit?: 'crop' | 'blur';
  hook?: {
    text: string;
    style?: StudioTextStyle;
    position?: StudioPosition;
    seconds?: number;
  };
  captions?: {
    source?: 'whisper' | 'script';
    script?: string;
    words: StudioWord[];
    style?: {
      font?: StudioTextStyle;
      maxWords?: number;
      maxChars?: number;
      position?: StudioPosition;
      color?: string;
      highlight?: string;
    };
  };
  // the templates made of pictures and clips, and the music most of them take
  music?: StudioMusic;
  style?: StudioTextStyle;
  position?: StudioPosition;
  slides?: StudioSlide[];
  transition?: string;
  pan?: boolean;
  before?: StudioCompareSide;
  after?: StudioCompareSide;
  layout?: 'stack' | 'wipe';
  seconds?: number;
  title?: string;
  items?: StudioListItem[];
  countdown?: boolean;
  quote?: string;
  author?: string;
  background?: {
    color?: string;
    mediaId?: string;
    path?: string;
    focus?: StudioFocus;
    start?: number;
  };
  textColor?: string;
  dim?: boolean;
  // AI UGC
  topic?: string;
  tone?: 'friendly' | 'excited' | 'calm' | 'expert' | 'funny';
  voiceover?: boolean;
  voice?: string;
  footage?: { mediaId: string; path?: string }[];
  stills?: number;
  script?: StudioAiScript;
  captionStyle?: {
    font?: StudioTextStyle;
    maxWords?: number;
    position?: StudioPosition;
    highlight?: string;
  };
};

export type StudioProjectSummary = {
  id: string;
  name: string;
  template: string;
  // "api" when an assistant or the public API made it
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudioProject = StudioProjectSummary & {
  spec: StudioSpec;
  renders: StudioRender[];
};

export const FINAL_RENDER_STATUSES = ['completed', 'failed', 'cancelled'];

// A finished video of any project, to schedule with others
export type StudioFinishedRender = StudioRender & {
  project: { name: string; template: string };
};

// A channel a finished video can go to, with the settings its network asks
// for (the same list the bulk video upload shows)
export type StudioScheduleChannel = {
  id: string;
  name: string;
  identifier: string;
  picture?: string | null;
  refreshNeeded?: boolean;
  // what the channel's flags mean together, decided by the backend
  state?: ChannelState;
  acceptsVideo: boolean;
  draftsOnly: boolean;
  settings: {
    key: string;
    type: 'text' | 'select' | 'boolean' | 'number';
    required: boolean;
    options?: string[];
    maxLength?: number;
    defaultValue?: string;
  }[];
};

// An error body is not a list or a project: SWR keeps it as an error, so the
// page renders its empty state instead of mapping over { message }
const json = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`Studio request failed (${response.status})`);
  }
  return response.json();
};

export const useStudioTemplates = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return json(await fetch('/studio/templates'));
  }, []);
  return useSWR<StudioTemplate[]>('studio-templates', load, {
    revalidateOnFocus: false,
  });
};

export const useStudioUsage = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return json(await fetch('/studio/usage'));
  }, []);
  return useSWR<StudioUsage>('studio-usage', load, {
    revalidateOnFocus: false,
  });
};

export const useStudioAi = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/studio/ai')).json();
  }, []);
  return useSWR<StudioAi>('studio-ai', load, {
    revalidateOnFocus: false,
  });
};

// Projects of assistants and the public API only when "api" is on
export const useStudioProjects = (api: boolean) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return json(await fetch(`/studio/projects${api ? '?api=true' : ''}`));
  }, [api]);
  return useSWR<StudioProjectSummary[]>(
    `studio-projects-${api ? 'all' : 'app'}`,
    load,
    {
      revalidateOnFocus: false,
    }
  );
};

export const useStudioProject = (id?: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return json(await fetch(`/studio/projects/${id}`));
  }, [id]);
  return useSWR<StudioProject>(id ? `studio-project-${id}` : null, load, {
    revalidateOnFocus: false,
  });
};

// Polled every 2 seconds until the render is done, failed or cancelled
export const useStudioRender = (id?: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return json(await fetch(`/studio/renders/${id}`));
  }, [id]);
  return useSWR<StudioRender>(id ? `studio-render-${id}` : null, load, {
    revalidateOnFocus: false,
    refreshInterval: (render) =>
      render && FINAL_RENDER_STATUSES.includes(render.status) ? 0 : 2000,
  });
};

export const useStudioFinishedRenders = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return json(await fetch('/studio/renders'));
  }, []);
  return useSWR<StudioFinishedRender[]>('studio-finished-renders', load, {
    revalidateOnFocus: false,
  });
};

export const useStudioScheduleChannels = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return json(await fetch('/posts-bulk-videos/channels'));
  }, []);
  return useSWR<StudioScheduleChannel[]>('studio-schedule-channels', load, {
    revalidateOnFocus: false,
  });
};
