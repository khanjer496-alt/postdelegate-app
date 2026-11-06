import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface MyReview {
  rating: number;
  text: string;
  displayName: string | null;
  roleCompany: string | null;
  consentToPublish: boolean;
}

export type ReviewStatus = 'NEW' | 'APPROVED' | 'HIDDEN';

export interface AdminReview {
  id: string;
  status: ReviewStatus;
  rating: number;
  text: string;
  displayName: string | null;
  roleCompany: string | null;
  consentToPublish: boolean;
  createdAt: string;
  email: string;
  organization: string;
}

export const useReviewPrompt = () => {
  const fetch = useFetch();
  return useSWR<{ eligible: boolean }>(
    '/reviews/prompt',
    async () => {
      const response = await fetch('/reviews/prompt');
      if (!response.ok) {
        throw new Error('Failed to load the review prompt');
      }
      return response.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
    }
  );
};

// The key is null until the form is open, nobody pays for it before
export const useMyReview = (enabled: boolean) => {
  const fetch = useFetch();
  return useSWR<MyReview | null>(
    enabled ? '/reviews/mine' : null,
    async () => {
      const response = await fetch('/reviews/mine');
      if (!response.ok) {
        throw new Error('Failed to load your review');
      }
      // no review yet is an empty body
      const body = await response.text();
      return body ? JSON.parse(body) : null;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

export const useAdminReviews = (status: ReviewStatus | '') => {
  const fetch = useFetch();
  const key = status ? `/admin/reviews?status=${status}` : '/admin/reviews';
  return useSWR<AdminReview[]>(
    key,
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to load reviews');
      }
      return response.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};
