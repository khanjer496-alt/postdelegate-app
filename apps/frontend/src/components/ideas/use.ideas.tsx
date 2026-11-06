'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { WorkspaceTag } from '@gitroom/frontend/components/launches/select.tags';

export type IdeaStatus = 'IDEA' | 'DRAFTING' | 'USED';

export type Idea = {
  id: string;
  title: string;
  notes: string | null;
  media: Array<{ id: string; path: string }>;
  status: IdeaStatus;
  createdAt: string;
  updatedAt: string;
  tag: Pick<WorkspaceTag, 'id' | 'name' | 'color' | 'kind'> | null;
};

export const useIdeas = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/ideas')).json();
  }, []);
  return useSWR<Idea[]>('ideas', load, {
    revalidateOnFocus: false,
  });
};
