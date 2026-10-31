import { defineSignal } from '@temporalio/workflow';

export type Email = {
  message: string;
  title?: string;
  type: 'success' | 'fail' | 'info';
  // only read by digestEmailWorkflowV3, older digest runs ignore them
  provider?: string;
  publishedLabel?: string;
  publishedLinkLabel?: string;
  createdAt?: string;
};

export const emailSignal = defineSignal<[Email[]]>('email');
