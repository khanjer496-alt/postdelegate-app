import {
  continueAsNew,
  isCancellation,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import type { TrialOnboardingActivity } from '@gitroom/orchestrator/activities/trial.onboarding.activity';

const { sendTrialOnboardingEmailsV1 } =
  proxyActivities<TrialOnboardingActivity>({
    taskQueue: 'main',
    startToCloseTimeout: '30 minutes',
    retry: {
      initialInterval: '1 minute',
      backoffCoefficient: 2,
      maximumInterval: '10 minutes',
      maximumAttempts: 3,
    },
  });

const HOUR = 60 * 60 * 1000;

// Every hour, a few minutes past it, sends the getting started emails of the
// trials that reached a step. One day per run, then a fresh history.
export async function trialOnboardingWorkflowV1(): Promise<void> {
  for (let i = 0; i < 24; i++) {
    try {
      await sendTrialOnboardingEmailsV1();
    } catch (error) {
      if (isCancellation(error)) throw error;
    }
    await sleep(HOUR - (Date.now() % HOUR) + 10 * 60 * 1000);
  }
  return continueAsNew<typeof trialOnboardingWorkflowV1>();
}
