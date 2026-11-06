import {
  continueAsNew,
  isCancellation,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import type { AnalyticsHistoryActivity } from '@gitroom/orchestrator/activities/analytics.history.activity';

const { sendAnalyticsReportsPageV1 } =
  proxyActivities<AnalyticsHistoryActivity>({
    taskQueue: 'main',
    startToCloseTimeout: '30 minutes',
    heartbeatTimeout: '2 minutes',
    retry: {
      initialInterval: '1 minute',
      backoffCoefficient: 2,
      maximumInterval: '30 minutes',
      maximumAttempts: 3,
    },
  });

// Every hour, sends the weekly and monthly analytics emails that are due. A
// report is marked sent before it goes out, so a retried page never sends the
// same period twice.
export async function analyticsReportWorkflowV1(
  args: { cursor?: string } = {}
): Promise<{ sent: number }> {
  let cursor = args.cursor;
  let sent = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    let page: Awaited<ReturnType<typeof sendAnalyticsReportsPageV1>>;
    try {
      page = await sendAnalyticsReportsPageV1(cursor);
    } catch (error) {
      if (isCancellation(error)) throw error;
      await sleep('15 minutes');
      return continueAsNew<typeof analyticsReportWorkflowV1>({ cursor });
    }
    if (!page.enabled) return { sent };
    sent += page.sent;
    if (!page.cursor) {
      await sleep('1 hour');
      return continueAsNew<typeof analyticsReportWorkflowV1>({});
    }
    if (page.cursor === cursor) {
      await sleep('15 minutes');
      return continueAsNew<typeof analyticsReportWorkflowV1>({ cursor });
    }
    cursor = page.cursor;
  }
  return continueAsNew<typeof analyticsReportWorkflowV1>({ cursor });
}
