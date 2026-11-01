'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { StudioWord } from '@gitroom/helpers/utils/studio.captions';
import type { StudioTextStyle } from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';

export type StudioPosition = 'top' | 'center' | 'bottom';

export type StudioTemplate = {
  identifier: string;
  title: string;
  description: string;
  captions: boolean;
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
};

export type StudioProjectSummary = {
  id: string;
  name: string;
  template: string;
  createdAt: string;
  updatedAt: string;
};

export type StudioProject = StudioProjectSummary & {
  spec: StudioSpec;
  renders: StudioRender[];
};

export const FINAL_RENDER_STATUSES = ['completed', 'failed', 'cancelled'];

export const useStudioTemplates = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/studio/templates')).json();
  }, []);
  return useSWR<StudioTemplate[]>('studio-templates', load, {
    revalidateOnFocus: false,
  });
};

export const useStudioUsage = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/studio/usage')).json();
  }, []);
  return useSWR<StudioUsage>('studio-usage', load, {
    revalidateOnFocus: false,
  });
};

export const useStudioProjects = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/studio/projects')).json();
  }, []);
  return useSWR<StudioProjectSummary[]>('studio-projects', load, {
    revalidateOnFocus: false,
  });
};

export const useStudioProject = (id?: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch(`/studio/projects/${id}`)).json();
  }, [id]);
  return useSWR<StudioProject>(id ? `studio-project-${id}` : null, load, {
    revalidateOnFocus: false,
  });
};

// Polled every 2 seconds until the render is done, failed or cancelled
export const useStudioRender = (id?: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch(`/studio/renders/${id}`)).json();
  }, [id]);
  return useSWR<StudioRender>(id ? `studio-render-${id}` : null, load, {
    revalidateOnFocus: false,
    refreshInterval: (render) =>
      render && FINAL_RENDER_STATUSES.includes(render.status) ? 0 : 2000,
  });
};
