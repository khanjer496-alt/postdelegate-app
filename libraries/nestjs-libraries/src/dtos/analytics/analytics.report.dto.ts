import { AnalyticsReportFrequency } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class AnalyticsReportSettingsDto {
  @IsEnum(AnalyticsReportFrequency)
  frequency: AnalyticsReportFrequency;

  // user ids, only active members of the workspace are kept
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  recipients: string[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brandName?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  logoUrl?: string | null;
}

export class AnalyticsReportDataDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}
