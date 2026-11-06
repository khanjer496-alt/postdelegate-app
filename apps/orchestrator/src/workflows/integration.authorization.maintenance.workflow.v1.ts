import { continueAsNew, isCancellation, proxyActivities, sleep } from '@temporalio/workflow';
import type { IntegrationAuthorizationMaintenanceActivity } from '@gitroom/orchestrator/activities/integration.authorization.maintenance.activity';

const { checkIntegrationAuthorizationsPageV1 } = proxyActivities<IntegrationAuthorizationMaintenanceActivity>({
  taskQueue: 'main',
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '1 minute',
    backoffCoefficient: 2,
    maximumInterval: '30 minutes',
    maximumAttempts: 3,
  },
});

export async function integrationAuthorizationMaintenanceWorkflowV1(
  args: { cursor?: string } = {}
): Promise<{ checked: number; pending: number }> {
  let cursor = args.cursor;
  let checked = 0;
  let pending = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    let page: Awaited<ReturnType<typeof checkIntegrationAuthorizationsPageV1>>;
    try {
      page = await checkIntegrationAuthorizationsPageV1(cursor);
    } catch (error) {
      if (isCancellation(error)) throw error;
      await sleep('15 minutes');
      return continueAsNew<typeof integrationAuthorizationMaintenanceWorkflowV1>({ cursor });
    }
    if (!page.enabled) return { checked, pending };
    checked += page.checked;
    pending += page.pending;
    if (!page.cursor) {
      await sleep('24 hours');
      return continueAsNew<typeof integrationAuthorizationMaintenanceWorkflowV1>({});
    }
    if (page.cursor === cursor) {
      // A stalled cursor must not spin or skip unprocessed integrations.
      await sleep('15 minutes');
      return continueAsNew<typeof integrationAuthorizationMaintenanceWorkflowV1>({ cursor });
    }
    cursor = page.cursor;
  }
  return continueAsNew<typeof integrationAuthorizationMaintenanceWorkflowV1>({ cursor });
}
