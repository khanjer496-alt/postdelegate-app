import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import {
  ActivityFailure,
  ApplicationFailure,
  startChild,
  proxyActivities,
  sleep,
  condition,
  defineSignal,
  setHandler,
} from '@temporalio/workflow';
import dayjs from 'dayjs';
import { Integration, State } from '@prisma/client';
import { capitalize, sortBy } from 'lodash';
import { PostResponse } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  TimeoutFailure,
  TimeoutType,
  TypedSearchAttributes,
} from '@temporalio/common';
import { postId as postIdSearchParam } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';

// The publishing activities heartbeat every 15s (withHeartbeat sends its first
// heartbeat at the first interval tick, not at entry), so a heartbeat timeout
// whose failure carries no heartbeat details means the server never received
// one: the worker never ran the activity, or it died within its first seconds.
const HEARTBEAT_TIMEOUT = 3 * 60 * 1000;

const proxyTaskQueue = (taskQueue: string) => {
  return proxyActivities<PostActivity>({
    startToCloseTimeout: '10 minute',
    taskQueue,
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });
};

// postComment publishes through providers that can legitimately run long
// (media conversion + upload), so it gets a large time budget. The
// heartbeatTimeout exists to detect an activity that was never started: the
// activity heartbeats every 15s, so no heartbeat at all means the worker never
// ran it and nothing was published. No SDK retries: an
// automatic retry of a heartbeat timeout would run again even when the first
// attempt did publish, duplicating the comment. The workflow decides whether
// a failure is safe to retry (see handleActivityError).
const proxyCommentTaskQueue = (taskQueue: string) => {
  return proxyActivities<PostActivity>({
    startToCloseTimeout: '30 minute',
    heartbeatTimeout: HEARTBEAT_TIMEOUT,
    taskQueue,
    retry: {
      maximumAttempts: 1,
    },
  });
};

// checkPostStatus is a single read-only status call, so it gets a short timeout
// and fast retries - retrying it can never duplicate a post.
const proxyCheckTaskQueue = (taskQueue: string) => {
  return proxyActivities<PostActivity>({
    startToCloseTimeout: '2 minute',
    taskQueue,
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '10 seconds',
    },
  });
};

// postSocialPending / finalizePost run irreversible publishing mutations, so no
// automatic retries - a retried activity whose previous (timed-out) attempt
// still completed in the background would publish twice. The workflow retries
// deliberately, and treats timeouts as "outcome unknown".
// The heartbeatTimeout exists to detect an activity that was never started:
// both activities heartbeat every 15s, so no heartbeat at all means the
// worker never ran them and nothing was published. The workflow
// decides whether that is safe to retry (see handleActivityError); every
// other timeout still marks the post as unconfirmed.
const proxyMutationTaskQueue = (taskQueue: string) => {
  return proxyActivities<PostActivity>({
    startToCloseTimeout: '30 minute',
    heartbeatTimeout: HEARTBEAT_TIMEOUT,
    taskQueue,
    retry: {
      maximumAttempts: 1,
    },
  });
};

const {
  getPostsList,
  getPost,
  hasActiveSubscription,
  inAppNotification,
  updatePost,
  sendWebhooks,
  isCommentable,
} = proxyActivities<PostActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

// changeStateIf records how a publish ended, and it must never be skipped:
// until it lands the post stays QUEUE, and once this run is closed - failed or
// completed alike - the hourly missing-posts sweep starts a fresh run on the
// same workflow id (signalWithStart with the default ALLOW_DUPLICATE reuse
// policy) that publishes the post again. While this run is still open the
// sweep only pokes it (USE_EXISTING), so the write keeps retrying for longer
// than the sweep looks back (publishDate within the last 2 days). If it still
// fails after that, the run fails, and the sweep no longer selects the post.
const { changeStateIf } = proxyActivities<PostActivity>({
  startToCloseTimeout: '1 minute',
  scheduleToCloseTimeout: '3 days',
  retry: {
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumInterval: '1 hour',
  },
});

const poke = defineSignal('poke');

const iterate = Array.from({ length: 5 });

// ~30 minutes at 20s interval (longer than the old in-activity loop, timers are
// free). Multi-item flows (stories, chunked uploads) consume several checks per
// item, so the budget must cover the largest realistic post, not one poll cycle.
const maxPendingChecks = 90;

// How a post or a comment failed:
// 'unconfirmed' - the platform may have accepted it, the user must check the
//                 account before posting again
// 'bad-body' - the platform refused it
// 'error' - a refused token refresh or any other error
type Failure = {
  type: 'unconfirmed' | 'bad-body' | 'error';
  err: any;
  message?: string;
};

export async function postWorkflowV113({
  taskQueue,
  postId,
  organizationId,
  postNow = false,
}: {
  taskQueue: string;
  postId: string;
  organizationId: string;
  postNow?: boolean;
}) {
  // Dynamic task queue, for concurrency
  const {
    getIntegrationById,
    refreshTokenWithCause,
    internalPlugs,
    globalPlugs,
    processInternalPlug,
    processPlug,
  } = proxyTaskQueue(taskQueue);

  const { checkPostStatus } = proxyCheckTaskQueue(taskQueue);

  const { postComment } = proxyCommentTaskQueue(taskQueue);

  const { postSocialPending, finalizePost } = proxyMutationTaskQueue(taskQueue);

  let poked = false;
  setHandler(poke, () => {
    poked = true;
  });

  // Every state write below is conditional: it only lands while the row is
  // still in one of these states. A scheduled run owns a QUEUE post, a repeat
  // run (postNow) publishes a PUBLISHED one again. A draft, a post another run
  // already published or failed, or a deleted post is not this run's to
  // overwrite.
  const writable: State[] = postNow ? ['QUEUE', 'PUBLISHED'] : ['QUEUE'];

  // getPost / getPostsList return nothing both for a deleted post and for an
  // organization without an active subscription. A deleted post has nothing
  // to record, a lapsed subscription is an error the user has to see.
  const stopMissingPost = async () => {
    if (await hasActiveSubscription(organizationId)) {
      return;
    }

    await changeStateIf(
      postId,
      writable,
      'ERROR',
      'This post was not published because the organization has no active subscription.'
    );
  };

  // get the post to schedule
  let firstPost = await getPost(organizationId, postId);

  if (!firstPost) {
    await stopMissingPost();
    return;
  }

  // wait for the scheduled publish date. A poke (the missing-posts sweep)
  // wakes the wait early, and every wake re-reads the post: a moved date is
  // waited for again, and a post that was deleted, published or moved to draft
  // in the meantime is left alone.
  if (!postNow) {
    while (true) {
      if (firstPost.state !== 'QUEUE') {
        return;
      }

      const wait = dayjs(firstPost.publishDate).diff(dayjs(), 'millisecond');
      if (wait <= 0) {
        break;
      }

      await condition(() => poked, wait);
      poked = false;

      firstPost = await getPost(organizationId, postId);
      if (!firstPost) {
        await stopMissingPost();
        return;
      }
    }
  }

  // Captured AFTER the scheduling wait: the repeat-post delay is
  // "interval minus time spent publishing", so it must be measured from the
  // publish time, not from when the workflow was started. Measuring from the
  // workflow start subtracted the whole scheduling wait from the interval
  // (a post scheduled further out than its interval repeated immediately).
  const startTime = new Date();

  const postsListBefore = await getPostsList(organizationId, postId);
  const [post] = postsListBefore;

  if (!post) {
    await stopMissingPost();
    return;
  }

  // changed since the wait ended: not this run's to publish anymore
  if (!postNow && post.state !== 'QUEUE') {
    return;
  }

  // if refresh is needed from last time, let's inform the user
  if (post.integration?.refreshNeeded) {
    if (
      await changeStateIf(
        postsListBefore[0].id,
        writable,
        'ERROR',
        'Refresh channel needed',
        postsListBefore
      )
    ) {
      await inAppNotification(
        post.organizationId,
        `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
        `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because you need to reconnect it. Please enable it and try again.`,
        true,
        false,
        'info'
      );
    }
    return;
  }

  // if it's disabled, inform the user
  if (post.integration?.disabled) {
    if (
      await changeStateIf(
        postsListBefore[0].id,
        writable,
        'ERROR',
        'Channel disabled',
        postsListBefore
      )
    ) {
      await inAppNotification(
        post.organizationId,
        `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
        `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because it's disabled. Please enable it and try again.`,
        true,
        false,
        'info'
      );
    }
    return;
  }

  // Do we need to post comment for this social?
  const toComment: boolean =
    postsListBefore.length === 1
      ? false
      : await isCommentable(post.integration);

  const postsList = toComment ? postsListBefore : [postsListBefore[0]];

  // list of all the saved results
  const postsResults: PostResponse[] = [];

  // a comment of the thread failed in this run: the main post is live, but
  // the next repeat would publish it without the failed comment, so the chain
  // ends here
  let threadFailed = false;

  // Every catch block below used to repeat the same failure classification, so
  // it is centralized here: detect the failure type, refresh the token when
  // needed, and tell the caller what to do.
  // 'retry' - the token was refreshed, or the activity never started (heartbeat
  //           timeout with no heartbeat), run the action again
  // 'stop' - the token could not be refreshed
  // 'bad-body' - the platform rejected the action
  // 'timeout' - the activity timed out, its outcome is unknown
  // 'unknown' - anything else (transient errors)
  const handleActivityError = async (
    err: unknown,
    getIntegration?: () => Promise<any>,
    heartbeats?: boolean
  ): Promise<{
    type: 'retry' | 'stop' | 'bad-body' | 'timeout' | 'unknown';
    message: string;
  }> => {
    if (
      err instanceof ActivityFailure &&
      err.cause instanceof TimeoutFailure
    ) {
      // The server copies the last heartbeat details it received into the
      // timeout failure. None at all (undefined) means it never received a
      // heartbeat: the worker never ran the activity, so nothing was published
      // and it is safe to run again. Any details mean the activity ran and
      // then stalled, so its outcome is unknown. This relies on withHeartbeat
      // always sending a non-empty string ("<activityType>: entered" at least):
      // a heartbeat sent with undefined details also leaves the failure
      // without details. Only the callers of heartbeating activities opt in;
      // no time window, so activity dispatch delay cannot skew the decision.
      if (
        heartbeats &&
        err.cause.timeoutType === TimeoutType.HEARTBEAT &&
        !err.cause.lastHeartbeatDetails
      ) {
        return { type: 'retry', message: '' };
      }
      return { type: 'timeout', message: '' };
    }

    const cause =
      err instanceof ActivityFailure && err.cause instanceof ApplicationFailure
        ? err.cause
        : undefined;

    if (cause?.type === 'refresh_token') {
      const refresh = await refreshTokenWithCause(
        getIntegration ? await getIntegration() : post.integration,
        cause.message || ''
      );
      if (!refresh || !refresh.accessToken) {
        return { type: 'stop', message: cause.message || '' };
      }

      if (!getIntegration) {
        post.integration.token = refresh.accessToken;
      }

      return { type: 'retry', message: cause.message || '' };
    }

    if (cause?.type === 'bad_body') {
      return { type: 'bad-body', message: cause.message || '' };
    }

    return { type: 'unknown', message: '' };
  };

  // What the platform already returned for an item that went out: kept on
  // the row even when it ends in ERROR, so the user can find the live post.
  const releaseOf = (i: number) => {
    const result = postsResults[i];
    return result && result.status !== 'pending' && result.postId
      ? { releaseId: String(result.postId), releaseURL: result.releaseURL }
      : undefined;
  };

  // Records a failure on the row that failed. The root keeps the whole thread
  // in the error log, as before. A failed comment leaves the published root
  // alone, and the comments after it can no longer be replied in place, so
  // they are failed too instead of staying QUEUE forever.
  const recordFailure = async (i: number, failure: Failure) => {
    const wrote = await changeStateIf(
      postsList[i].id,
      writable,
      'ERROR',
      failure.err,
      i === 0 ? postsList : [postsList[i]],
      releaseOf(i)
    );

    if (i > 0) {
      for (const rest of postsList.slice(i + 1)) {
        await changeStateIf(
          rest.id,
          writable,
          'ERROR',
          'Not published because an earlier comment failed'
        );
      }
    }

    // deleted, moved to draft or already failed by an earlier write: there
    // is nothing new to tell the user
    if (!wrote) {
      return;
    }

    // the failure is recorded, a notification that can't be sent must not end
    // the run: the root may be live, with webhooks and plugs still to run.
    // Every failure is told: the calendar only shows the main post, so a
    // failed comment under a live post is invisible otherwise.
    try {
      if (failure.type === 'unconfirmed') {
        // The platform may have accepted it but we can't confirm it was
        // published - the user checks the account before reposting manually
        // and duplicating it.
        await inAppNotification(
          post.organizationId,
          `We couldn't confirm your ${i === 0 ? 'post' : 'comment'} on ${capitalize(
            post.integration?.providerIdentifier
          )}`,
          i === 0
            ? `Your post was sent to ${capitalize(
                post.integration?.providerIdentifier
              )}, but we couldn't confirm it was published. Please check your ${
                post?.integration?.name
              } account before posting again to avoid duplicates.`
            : `Your post is live on ${capitalize(
                post.integration?.providerIdentifier
              )}, but we couldn't confirm a comment in its thread was published. Please check your ${
                post?.integration?.name
              } account before posting it again to avoid duplicates.`,
          true,
          false,
          'fail'
        );
      } else {
        await inAppNotification(
          post.organizationId,
          `Error posting${i === 0 ? ' ' : ' comments '}on ${
            post.integration?.providerIdentifier
          } for ${post?.integration?.name}`,
          i === 0
            ? `An error occurred while posting on ${
                post.integration?.providerIdentifier
              }${failure.message ? `: ${failure.message}` : ``}`
            : `Your post is live on ${
                post.integration?.providerIdentifier
              }, but a comment in its thread could not be published${
                failure.message ? `: ${failure.message}` : ``
              }`,
          true,
          false,
          'fail'
        );
      }
    } catch (e) {
      /**empty**/
    }
  };

  // The post/comment was already accepted by the platform but returned as
  // "pending": poll the read-only status check with durable timers until it
  // completes. It never writes state and never rethrows a check failure: it
  // returns how the item failed, the caller records it.
  const resolvePending = async (
    pending: PostResponse
  ): Promise<PostResponse | Failure> => {
    let pendingData = pending.pendingData;
    let errorAttempts = 0;
    let heartbeats = false;

    for (let check = 0; check < maxPendingChecks; check++) {
      // only finalizePost heartbeats, so a checkPostStatus failure must never
      // be classified as never started
      heartbeats = false;
      try {
        let result = await checkPostStatus(post.integration, pendingData);

        // commit the check's state BEFORE finalizePost runs: if finalize dies
        // mid-mutation, the next check must see what it had already authorized,
        // so providers can detect the interrupted attempt instead of running
        // the mutation again
        if (result.status !== 'completed') {
          pendingData = result.pendingData;
        }

        // polling is done, run the remaining provider mutations
        if (result.status === 'ready') {
          heartbeats = true;
          result = await finalizePost(post.integration, result.pendingData);
        }

        if (result.status === 'completed') {
          return {
            id: pending.id,
            postId: result.postId,
            releaseURL: result.releaseURL,
            status: 'success',
          };
        }

        pendingData = result.pendingData;

        // a fully successful iteration proves the platform is reachable: the
        // error budget bounds consecutive failures, not blips accumulated over
        // a long upload
        errorAttempts = 0;
      } catch (err) {
        const handle = await handleActivityError(err, undefined, heartbeats);

        // token refreshed, or finalize never started, check again right away
        if (handle.type === 'retry') {
          continue;
        }

        // the token could not be refreshed while checking, but the platform
        // already accepted the post - warn about a possible live post
        if (handle.type === 'stop') {
          return { type: 'unconfirmed', err };
        }

        // the platform explicitly failed the post, it was not published
        if (handle.type === 'bad-body') {
          return { type: 'bad-body', err, message: handle.message };
        }

        // unknown error on a read-only check, retry a few more times
        errorAttempts++;
        if (errorAttempts >= iterate.length) {
          break;
        }
      }

      // the platform is still processing, wait before the next check
      await sleep('20 seconds');
    }

    // no verdict from the platform after all the checks
    return { type: 'unconfirmed', err: 'Could not confirm the post status' };
  };

  // iterate over the posts
  for (let i = 0; i < postsList.length; i++) {
    const before = postsResults.length;
    // once the platform accepted the post, the catch below must never retry
    // the publish - retrying after updatePost / notification errors would
    // duplicate the post
    let posted = false;
    let updated = false;
    // how this item failed, recorded once the attempts are over: the write
    // sits outside the try, so a failing write is never taken for a failed
    // publish
    let failure: Failure | undefined;

    // this is a small trick to repeat an action in case of token refresh
    for (const _ of iterate) {
      // both publish calls run heartbeating activities, but the timed-out
      // status checks below must never be mistaken for never-started
      let heartbeats = false;
      try {
        // first post the main post
        if (i === 0) {
          heartbeats = true;
          postsResults.push(
            ...(await postSocialPending(post.integration as Integration, [
              postsList[i],
            ]))
          );

          // then post the comments if any
        } else {
          if (postsList[i].delay) {
            await sleep(60000 * Math.max(0, Number(postsList[i].delay ?? 0)));
          }

          heartbeats = true;
          postsResults.push(
            ...(await postComment(
              postsResults[0].postId,
              postsResults.length === 1
                ? undefined
                : postsResults[i - 1].postId,
              post.integration,
              [postsList[i]]
            ))
          );
        }

        posted = true;

        // the platform accepted the post but is still processing it: resolve
        // it here before marking anything, resolvePending handles its own
        // check errors so a failed status check can never re-run the publish
        if (postsResults[i].status === 'pending') {
          const resolved = await resolvePending(postsResults[i]);
          if ('type' in resolved) {
            failure = resolved;
            break;
          }
          postsResults[i] = resolved;
        }

        // mark post as successful
        await updatePost(
          postsList[i].id,
          postsResults[i].postId,
          postsResults[i].releaseURL
        );
        updated = true;

        if (i === 0) {
          // send notification on a sucessful post
          await inAppNotification(
            post.integration.organizationId,
            `Your post has been published on ${capitalize(
              post.integration.providerIdentifier
            )}`,
            `Your post has been published on ${capitalize(
              post.integration.providerIdentifier
            )} at ${postsResults[0].releaseURL}`,
            true,
            true
          );
        }

        // break the current while to move to the next post
        break;
      } catch (err) {
        // the post is already live: never re-run the publish
        if (posted) {
          // still marked QUEUE, record the error so the missing-posts sweep
          // doesn't re-publish it
          if (!updated) {
            failure = { type: 'unconfirmed', err };
          }

          // already marked published, a failed notification shouldn't abort
          // the rest of the flow
          break;
        }

        const handle = await handleActivityError(err, undefined, heartbeats);

        // token refreshed, or the publish never started: nothing went out,
        // repeat the action
        if (handle.type === 'retry') {
          continue;
        }

        // Anything else is final, the same as a token refresh: a timed-out
        // publish may still complete in the background, and an unknown error
        // may come after the platform accepted it, so publishing again could
        // duplicate the post or the comment
        failure =
          handle.type === 'timeout'
            ? { type: 'unconfirmed', err }
            : handle.type === 'bad-body'
            ? { type: 'bad-body', err, message: handle.message }
            : { type: 'error', err, message: handle.message };
        break;
      }
    }

    if (!failure && postsResults.length === before) {
      // all retries exhausted without success: record it, otherwise the post
      // stays in QUEUE with no error and the missing-posts sweep re-publishes
      // it. A retried publish may have run without reporting, so treat the
      // outcome as unknown.
      failure = {
        type: 'unconfirmed',
        err: 'Could not publish after several attempts',
      };
    }

    if (failure) {
      await recordFailure(i, failure);

      // the main post didn't go out, there is nothing to follow up on
      if (i === 0) {
        return false;
      }

      // a comment failed under a live main post: the rest of the thread is
      // failed with it, the main post still gets its webhooks and plugs, but
      // no next repeat
      threadFailed = true;
      break;
    }
  }

  // send webhooks for the post
  await sendWebhooks(
    postsResults[0].postId,
    post.organizationId,
    post.integration.id
  );

  // load internal plugs like repost by other users
  const internalPlugsList = await internalPlugs(
    post.integration,
    JSON.parse(post.settings)
  );

  // load global plugs, like repost a post if it gets to a certain number of likes
  const globalPlugsList = (await globalPlugs(post.integration)).reduce(
    (all, current) => {
      for (let i = 1; i <= current.totalRuns; i++) {
        all.push({
          ...current,
          delay: current.delay * i,
        });
      }

      return all;
    },
    []
  );

  // Check if the post is repeatable
  const repeatPost =
    !post.intervalInDays || threadFailed
      ? []
      : [
          {
            type: 'repeat-post',
            delay:
              post.intervalInDays * 24 * 60 * 60 * 1000 -
              (new Date().getTime() - startTime.getTime()),
          },
        ];

  // Sort all the actions by delay, so we can process them in order
  const list = sortBy(
    [...internalPlugsList, ...globalPlugsList, ...repeatPost],
    'delay'
  );

  // process all the plugs in order, we are using while because in some cases we need to remove items from the list
  while (list.length > 0) {
    // get the next to process
    const todo = list.shift();

    // wait for the delay
    await sleep(Math.max(0, Number(todo.delay ?? 0)));

    // process internal plug
    if (todo.type === 'internal-plug') {
      for (const _ of iterate) {
        try {
          await processInternalPlug({ ...todo, post: postsResults[0].postId });
        } catch (err) {
          const handle = await handleActivityError(err, () =>
            getIntegrationById(organizationId, todo.integration)
          );

          if (handle.type === 'stop' || handle.type === 'bad-body') {
            break;
          }

          continue;
        }
        break;
      }
    }

    // process global plug
    if (todo.type === 'global') {
      for (const _ of iterate) {
        try {
          const process = await processPlug({
            ...todo,
            postId: postsResults[0].postId,
          });
          if (process) {
            const toDelete = list
              .reduce((all, current, index) => {
                if (current.plugId === todo.plugId) {
                  all.push(index);
                }

                return all;
              }, [])
              .reverse();

            for (const index of toDelete) {
              list.splice(index, 1);
            }
          }
        } catch (err) {
          const handle = await handleActivityError(err);

          if (handle.type === 'stop' || handle.type === 'bad-body') {
            break;
          }

          continue;
        }

        break;
      }
    }

    // process repeat post in a new workflow, this is important so the other plugs can keep running
    if (todo.type === 'repeat-post') {
      await startChild(postWorkflowV113, {
        parentClosePolicy: 'ABANDON',
        args: [
          {
            taskQueue,
            postId,
            organizationId,
            postNow: true,
          },
        ],
        workflowId: `post_${post.id}_${makeId(10)}`,
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: postIdSearchParam,
            value: postId,
          },
        ]),
      });
    }
  }
}
