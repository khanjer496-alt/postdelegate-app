import { IsDefined, IsInt, Max, Min } from 'class-validator';
import { MAX_EXTRA_CHANNELS } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

export class BillingExtraChannelsDto {
  @IsDefined()
  @IsInt()
  @Min(0)
  @Max(MAX_EXTRA_CHANNELS)
  extraChannels: number;
}
