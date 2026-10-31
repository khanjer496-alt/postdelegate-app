import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { TrialOnboardingService } from '@gitroom/nestjs-libraries/database/prisma/trial-onboarding/trial.onboarding.service';

@Injectable()
@Activity()
export class TrialOnboardingActivity {
  constructor(private _trialOnboardingService: TrialOnboardingService) {}

  @ActivityMethod()
  async sendTrialOnboardingEmailsV1(): Promise<{
    checked: number;
    sent: number;
  }> {
    return this._trialOnboardingService.sendDueEmails();
  }
}
