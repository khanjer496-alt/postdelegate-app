import { Injectable } from '@nestjs/common';
import {
  AdminStatsRepository,
  GrowthParams,
  OrgActivityParams,
  StatsParams,
} from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.repository';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';

@Injectable()
export class AdminStatsService {
  constructor(
    private _adminStatsRepository: AdminStatsRepository,
    private _paymentService: PaymentService
  ) {}

  getStats(params: StatsParams) {
    return this._adminStatsRepository.getStats(params);
  }

  getOrgActivity(params: OrgActivityParams) {
    return this._adminStatsRepository.getOrgActivity(params);
  }

  // Sign-ups from our database, trials and revenue from the billing
  // providers, comped plans from our subscriptions (admin set ones are
  // stored under the web provider, like add-subscription does)
  async getGrowth(params: GrowthParams) {
    const [signUps, comped, billing] = await Promise.all([
      this._adminStatsRepository.getSignUps(params),
      this._adminStatsRepository.getCompedSubscriptions(
        this._paymentService.getDefaultProviderName('web')
      ),
      this._paymentService.getGrowthStats(params.from, params.to),
    ]);

    return {
      from: params.from.toISOString(),
      to: params.to.toISOString(),
      signUps,
      comped,
      billing,
    };
  }
}
