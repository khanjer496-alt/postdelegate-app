import {
  continueAsNew,
  isCancellation,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import type { WeeklySummaryActivity } from '@gitroom/orchestrator/activities/weekly.summary.activity';

const { sendWeeklySummariesV1 } = proxyActivities<WeeklySummaryActivity>({
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

// Every hour, a few minutes past it, sends the Monday summary to the members
// whose local time just reached Monday morning. One day per run, then a fresh
// history.
export async function weeklySummaryWorkflowV1(): Promise<void> {
  for (let i = 0; i < 24; i++) {
    try {
      await sendWeeklySummariesV1();
    } catch (error) {
      if (isCancellation(error)) throw error;
    }
    await sleep(HOUR - (Date.now() % HOUR) + 5 * 60 * 1000);
  }
  return continueAsNew<typeof weeklySummaryWorkflowV1>();
}
