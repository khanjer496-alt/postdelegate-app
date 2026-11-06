import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { WeeklySummaryService } from '@gitroom/nestjs-libraries/database/prisma/weekly-summary/weekly.summary.service';

@Injectable()
@Activity()
export class WeeklySummaryActivity {
  constructor(private _weeklySummaryService: WeeklySummaryService) {}

  @ActivityMethod()
  async sendWeeklySummariesV1(): Promise<{ checked: number; sent: number }> {
    return this._weeklySummaryService.sendDueSummaries();
  }
}
