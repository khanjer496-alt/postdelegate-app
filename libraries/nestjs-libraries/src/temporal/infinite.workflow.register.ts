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
      // the Monday summary email; the activity does nothing without an email
      // provider or with WEEKLY_SUMMARY_DISABLED=true
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('weeklySummaryWorkflowV1', {
            workflowId: 'weekly-summary-workflow-v1',
            taskQueue: 'main',
          });
      } catch (err) {}
      // the getting started emails of new trials; the activity does nothing
      // without an email provider or with TRIAL_ONBOARDING_EMAILS_DISABLED=true
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('trialOnboardingWorkflowV1', {
            workflowId: 'trial-onboarding-workflow-v1',
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
    // Daily analytics history and the scheduled analytics emails, on unless
    // switched off; the activities check the same switches on every page
    if (process.env.ANALYTICS_HISTORY_DISABLED !== 'true') {
      await this.startSingleton('analyticsSnapshotWorkflowV1', 'analytics-snapshot-v1');
    }
    if (process.env.ANALYTICS_REPORTS_DISABLED !== 'true') {
      await this.startSingleton('analyticsReportWorkflowV1', 'analytics-report-v1');
    }
  }

  private async startSingleton(workflowType: string, workflowId: string) {
    try {
      const workflow = this._temporalService.client?.getRawClient()?.workflow;
      if (!workflow) throw new Error('Temporal client is unavailable.');
      await workflow.start(workflowType, { workflowId, taskQueue: 'main' });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'WorkflowExecutionAlreadyStartedError') {
        this._logger.warn(`Could not start ${workflowType}.`);
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
