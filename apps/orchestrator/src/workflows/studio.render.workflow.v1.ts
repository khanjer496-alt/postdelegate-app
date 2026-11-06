import {
  ActivityCancellationType,
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  TimeoutFailure,
  isCancellation,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import { TimeoutType } from '@temporalio/common';
import { StudioActivity } from '@gitroom/orchestrator/activities/studio.activity';

// Bookkeeping is idempotent: ride out an outage of a few minutes
const { prepareStudioRenderV1, finishStudioRenderV1, failStudioRenderV1 } =
  proxyActivities<StudioActivity>({
    startToCloseTimeout: '2 minute',
    taskQueue: 'main',
    retry: {
      maximumAttempts: 10,
      backoffCoefficient: 2,
      initialInterval: '10 seconds',
      maximumInterval: '2 minutes',
    },
  });

// The render runs on its own queue, so the number of ffmpeg processes is the
// concurrency of that queue (STUDIO_RENDER_CONCURRENCY) and never competes
// with publishing. A retry downloads and renders again, which only costs
// time. A cancel waits for ffmpeg to stop and the folder to be removed. A
// render no worker picked up within the hour gives up (Studio is busy)
const { renderStudioV1 } = proxyActivities<StudioActivity>({
  scheduleToStartTimeout: '1 hour',
  startToCloseTimeout: '30 minute',
  heartbeatTimeout: '2 minute',
  taskQueue: 'studio',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    maximumAttempts: 2,
    initialInterval: '30 seconds',
    nonRetryableErrorTypes: ['studio_stop'],
  },
});

// Only a "studio_stop" was written for the customer, anything else is logged
const reason = (err: any) => {
  const cause = err instanceof ActivityFailure ? err.cause : err;
  if (
    cause instanceof TimeoutFailure &&
    cause.timeoutType === TimeoutType.SCHEDULE_TO_START
  ) {
    return {
      error: 'Studio is busy, try again in a few minutes',
      customer: true,
    };
  }
  return {
    error: cause?.message || 'Render failed',
    customer:
      cause instanceof ApplicationFailure && cause.type === 'studio_stop',
  };
};

// A workspace renders one video at a time: the render waits until it is the
// oldest one the workspace has. Waiting is bounded by the stale check of the
// service, which closes a render that waited for hours
const WAIT_INTERVAL = '10 seconds';
const MAX_WAITS = 720;

export async function studioRenderWorkflowV1({
  renderId,
}: {
  renderId: string;
}) {
  try {
    for (let i = 0; ; i++) {
      const state = await prepareStudioRenderV1({ renderId });
      if (state === 'gone') {
        return;
      }
      if (state === 'ready') {
        break;
      }
      if (i >= MAX_WAITS) {
        throw ApplicationFailure.nonRetryable(
          'Studio is busy, try again in a few minutes',
          'studio_stop'
        );
      }
      await sleep(WAIT_INTERVAL);
    }

    await renderStudioV1({ renderId });
    await finishStudioRenderV1({ renderId });
  } catch (err: any) {
    // a cancelled render is still closed
    await CancellationScope.nonCancellable(() =>
      failStudioRenderV1({
        renderId,
        ...reason(err),
        cancelled: isCancellation(err),
      })
    );
  }
}
