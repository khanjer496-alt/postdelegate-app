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

// V1 with one step before the render: what the template asks the
// workspace's own AI for (a voice, word times, stills) is made first. V1
// stays as it is for the renders it already runs

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

// The AI step waits on the customer's AI, not on the CPU, so it runs on the
// main queue and never holds a render slot. Every file it makes is kept, so
// a retry only makes what is missing. A rejected key, an empty account or a
// refusal stops at once (studio_stop); a rate limit or an outage is tried 3
// times over a few minutes, never more, so a busy key is not hammered
// Each AI call has 4 minutes: a voice and its timing one after the other,
// the stills next to each other, and the uploads fit in 15
const { prepareStudioAiV1 } = proxyActivities<StudioActivity>({
  startToCloseTimeout: '15 minute',
  heartbeatTimeout: '2 minute',
  taskQueue: 'main',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    maximumAttempts: 3,
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumInterval: '2 minutes',
    nonRetryableErrorTypes: ['studio_stop'],
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

// "studio_stop" and "studio_ai_retry" were written for the customer, anything
// else is logged
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
      cause instanceof ApplicationFailure &&
      ['studio_stop', 'studio_ai_retry'].includes(cause.type || ''),
  };
};

// A workspace renders one video at a time: the render waits until it is the
// oldest one the workspace has. Waiting is bounded by the stale check of the
// service, which closes a render that waited for hours
const WAIT_INTERVAL = '10 seconds';
const MAX_WAITS = 720;

export async function studioRenderWorkflowV2({
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

    await prepareStudioAiV1({ renderId });
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
