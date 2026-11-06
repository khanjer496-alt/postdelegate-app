import {
  continueAsNew,
  isCancellation,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import type { AnalyticsHistoryActivity } from '@gitroom/orchestrator/activities/analytics.history.activity';

const { snapshotAnalyticsPageV1, purgeAnalyticsHistoryV1 } =
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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// pause between two pages that talked to providers, so the day's channels are
// spread out instead of read in one burst
const PAGE_GAP = '30 seconds';

// Once a day, walks every channel that has a history source in pages and
// stores its account and post metrics, then removes expired rows and waits
// for the next day. A page of channels already saved today costs no provider
// call, so a restart resumes instead of reading the same channels again.
export async function analyticsSnapshotWorkflowV1(
  args: { cursor?: string; cycleStartedAt?: number } = {}
): Promise<{ saved: number; failed: number }> {
  const cycleStartedAt = args.cycleStartedAt ?? Date.now();
  let cursor = args.cursor;
  let saved = 0;
  let failed = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    let page: Awaited<ReturnType<typeof snapshotAnalyticsPageV1>>;
    try {
      page = await snapshotAnalyticsPageV1(cursor);
    } catch (error) {
      if (isCancellation(error)) throw error;
      await sleep('15 minutes');
      return continueAsNew<typeof analyticsSnapshotWorkflowV1>({
        cursor,
        cycleStartedAt,
      });
    }
    if (!page.enabled) return { saved, failed };
    saved += page.saved;
    failed += page.failed;
    if (!page.cursor) {
      try {
        await purgeAnalyticsHistoryV1();
      } catch (error) {
        if (isCancellation(error)) throw error;
      }
      await sleep(Math.max(HOUR_MS, DAY_MS - (Date.now() - cycleStartedAt)));
      return continueAsNew<typeof analyticsSnapshotWorkflowV1>({});
    }
    if (page.cursor === cursor) {
      // A stalled cursor must not spin or skip unprocessed channels.
      await sleep('15 minutes');
      return continueAsNew<typeof analyticsSnapshotWorkflowV1>({
        cursor,
        cycleStartedAt,
      });
    }
    cursor = page.cursor;
    if (page.saved || page.failed) {
      await sleep(PAGE_GAP);
    }
  }
  return continueAsNew<typeof analyticsSnapshotWorkflowV1>({
    cursor,
    cycleStartedAt,
  });
}
