import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class InfiniteWorkflowRegister implements OnModuleInit {
  constructor(private _temporalService: TemporalService) {}
  private readonly _logger = new Logger(InfiniteWorkflowRegister.name);

  async onModuleInit(): Promise<void> {
    if (!!process.env.RUN_CRON) {
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('missingPostWorkflow', {
            workflowId: 'missing-post-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}
    }
    if (process.env.INTEGRATION_AUTHORIZATION_LIFECYCLE_ENABLED === 'true') {
      try {
        const workflow = this._temporalService.client?.getRawClient()?.workflow;
        if (!workflow) throw new Error('Temporal client is unavailable.');
        await workflow.start('integrationAuthorizationMaintenanceWorkflowV1', {
          workflowId: 'integration-authorization-maintenance-v1',
          taskQueue: 'main',
        });
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'WorkflowExecutionAlreadyStartedError') {
          // Do not log raw Temporal/provider payloads at this boundary.
          this._logger.warn('Could not start integration authorization maintenance.');
        }
      }
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [InfiniteWorkflowRegister],
  get exports() {
    return this.providers;
  },
})
export class InfiniteWorkflowRegisterModule {}
