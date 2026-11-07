import {
  continueAsNew,
  isCancellation,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import type { StudioActivity } from '@gitroom/orchestrator/activities/studio.activity';

const { cleanupStudioV1 } = proxyActivities<StudioActivity>({
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

// Once a day: removes the stored music of deleted Studio projects and the
// music no project has used for a week, and forgets render records older
// than 90 days (the videos stay in the media library). Ends when the
// cleanup is switched off. A failed run waits for the next day; what it
// missed is still there then
export async function studioCleanupWorkflowV1(): Promise<void> {
  try {
    const result = await cleanupStudioV1({});
    if (!result.enabled) return;
  } catch (error) {
    if (isCancellation(error)) throw error;
  }
  await sleep('24 hours');
  return continueAsNew<typeof studioCleanupWorkflowV1>();
}
