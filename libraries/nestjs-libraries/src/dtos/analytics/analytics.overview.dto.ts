import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsTimeZone } from 'class-validator';

export const ANALYTICS_OVERVIEW_RANGES = [7, 30, 90] as const;

export class AnalyticsOverviewDto {
  @Type(() => Number)
  @IsIn(ANALYTICS_OVERVIEW_RANGES)
  days: (typeof ANALYTICS_OVERVIEW_RANGES)[number];

  // the best days and hours are bucketed in this timezone, empty means UTC
  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}
