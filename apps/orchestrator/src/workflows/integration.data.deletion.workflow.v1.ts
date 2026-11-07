import { continueAsNew, isCancellation, proxyActivities, sleep } from '@temporalio/workflow';
import type { IntegrationAuthorizationMaintenanceActivity } from '@gitroom/orchestrator/activities/integration.authorization.maintenance.activity';

const { processIntegrationDataDeletionV1 } = proxyActivities<IntegrationAuthorizationMaintenanceActivity>({
  taskQueue: 'main',
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '1 minute',
    backoffCoefficient: 2,
    maximumInterval: '30 minutes',
    maximumAttempts: 3,
  },
});

// New workflow version: existing publishing/refresh workflow histories and
// activity signatures remain unchanged. Credentials never enter this history.
export async function integrationDataDeletionWorkflowV1(args: {
  organizationId: string;
  integrationId: string;
}): Promise<{ completed: number }> {
  for (let attempt = 0; attempt < 96; attempt++) {
    try {
      const result = await processIntegrationDataDeletionV1(args.organizationId, args.integrationId);
      if (result.completed === 1) return { completed: 1 };
    } catch (error) {
      if (isCancellation(error)) throw error;
      // An unknown revocation or object-store result is pending work. Never
      // convert an exhausted activity retry into a successful deletion result.
    }
    await sleep('15 minutes');
  }
  return continueAsNew<typeof integrationDataDeletionWorkflowV1>(args);
}
