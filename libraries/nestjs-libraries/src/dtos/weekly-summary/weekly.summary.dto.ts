import { IsBoolean } from 'class-validator';

export class WeeklySummaryDto {
  @IsBoolean()
  enabled: boolean;
}
