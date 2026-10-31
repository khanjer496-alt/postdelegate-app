'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export type ApprovalStatus =
  | 'NONE'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'REJECTED';

export interface ApprovalMember {
  id: string;
  email: string;
  name: string | null;
  role: 'SUPERADMIN' | 'ADMIN' | 'USER';
}

export interface ApprovalSettings {
  requireApproval: boolean;
  approverIds: string[];
  requireAgentApproval: boolean;
  requireApiApproval: boolean;
  agentIntegrationIds: string[];
  agentMaxPostsPerDay: number | null;
  isAdmin: boolean;
  canApprove: boolean;
  members: ApprovalMember[];
}

export interface ReviewItem {
  id: string;
  group: string;
  content: string;
  image: string | null;
  publishDate: string;
  approvalStatus: 'IN_REVIEW' | 'CHANGES_REQUESTED';
  agentSource: string | null;
  creationMethod: string;
  createdAt: string;
  integration: {
    id: string;
    name: string;
    picture: string | null;
    providerIdentifier: string;
  };
  submittedBy: string | null;
  submittedAt: string;
  changesRequested: { by: string | null; comment: string | null; at: string } | null;
}

export type ActivityAction =
  | 'CREATED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'PUBLISHED'
  | 'LINK_CREATED'
  | 'LINK_REVOKED'
  | 'LINK_VIEWED'
  | 'GUARDRAIL_BLOCKED'
  | 'SETTINGS_CHANGED';

export interface ActivityItem {
  id: string;
  action: ActivityAction;
  actorType: 'USER' | 'AGENT' | 'CLIENT' | 'SYSTEM';
  actorName: string | null;
  actorEmail: string | null;
  comment: string | null;
  createdAt: string;
  post: {
    id: string;
    group: string;
    deleted: boolean;
    content: string;
    integration: {
      name: string;
      picture: string | null;
      providerIdentifier: string;
    };
  } | null;
}

export interface ActivityPage {
  total: number;
  pages: number;
  items: ActivityItem[];
}

export interface ApprovalLink {
  id: string;
  postIds: string[];
  expiresAt: string;
  revokedAt: string | null;
  lastViewedAt: string | null;
  createdAt: string;
  status: 'active' | 'expired' | 'revoked';
}

const options = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
};

// throws on an error status so SWR keeps the error instead of bad data
const useJsonLoader = () => {
  const fetch = useFetch();
  return useCallback(
    async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error('Failed to load');
      }
      return response.json();
    },
    [fetch]
  );
};

export const useApprovalSettings = () => {
  const load = useJsonLoader();
  return useSWR<ApprovalSettings>('/approvals/settings', load, options);
};

export const useReviewCount = () => {
  const load = useJsonLoader();
  return useSWR<{ count: number }>('/approvals/review/count', load, {
    ...options,
    refreshInterval: 60000,
  });
};

export const useReviewQueue = (source: 'all' | 'agent') => {
  const load = useJsonLoader();
  return useSWR<ReviewItem[]>(`/approvals/review?source=${source}`, load, options);
};

export const usePostHistory = (postId?: string) => {
  const load = useJsonLoader();
  return useSWR<ActivityPage>(
    postId ? `/approvals/posts/${postId}/history` : null,
    load,
    options
  );
};

export const useActivity = (page: number) => {
  const load = useJsonLoader();
  // the pager stays in place while the next page loads
  return useSWR<ActivityPage>(`/approvals/activity?page=${page}`, load, {
    ...options,
    keepPreviousData: true,
  });
};

export const useApprovalLinks = () => {
  const load = useJsonLoader();
  return useSWR<ApprovalLink[]>('/approvals/links', load, options);
};

// the error message the backend sent, or a fallback
export const readError = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => ({}));
  const message = Array.isArray(body?.message)
    ? body.message[0]
    : body?.message || body?.msg;
  return typeof message === 'string' && message ? message : fallback;
};
