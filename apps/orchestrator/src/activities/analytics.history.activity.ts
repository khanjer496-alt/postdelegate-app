import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { AnalyticsSnapshotService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.snapshot.service';
import { AnalyticsReportService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service';
import { withHeartbeat } from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';

// The activities return only counts and the paging cursor (a channel or
// settings id), never provider responses or tokens. The report emails go out
// through the generic sendSingleEmailWorkflow, like every other email.
@Injectable()
@Activity()
export class AnalyticsHistoryActivity {
  constructor(
    private _snapshots: AnalyticsSnapshotService,
    private _reports: AnalyticsReportService
  ) {}

  @ActivityMethod()
  async snapshotAnalyticsPageV1(cursor?: string): Promise<{
    enabled: number;
    cursor?: string;
    saved: number;
    skipped: number;
    failed: number;
  }> {
    return withHeartbeat(async () => {
      const page = await this._snapshots.snapshotPage(cursor);
      return {
        enabled: page.enabled ? 1 : 0,
        ...(page.cursor ? { cursor: page.cursor } : {}),
        saved: page.saved,
        skipped: page.skipped,
        failed: page.failed,
      };
    });
  }

  @ActivityMethod()
  async purgeAnalyticsHistoryV1(): Promise<{ deleted: number }> {
    return withHeartbeat(async () => ({
      deleted: await this._snapshots.purgeExpired(),
    }));
  }

  @ActivityMethod()
  async sendAnalyticsReportsPageV1(cursor?: string): Promise<{
    enabled: number;
    cursor?: string;
    sent: number;
  }> {
    return withHeartbeat(async () => {
      const page = await this._reports.sendDueReportsPage(cursor);
      return {
        enabled: page.enabled ? 1 : 0,
        ...(page.cursor ? { cursor: page.cursor } : {}),
        sent: page.sent,
      };
    });
  }
}
