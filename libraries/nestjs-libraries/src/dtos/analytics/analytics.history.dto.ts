import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsTimeZone,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ANALYTICS_OVERVIEW_RANGES } from '@gitroom/nestjs-libraries/dtos/analytics/analytics.overview.dto';

export const TOP_POSTS_SORTS = [
  'engagement',
  'views',
  'likes',
  'comments',
  'shares',
  'date',
] as const;

// comma-separated channel ids, e.g. ?integrations=a,b
const toIdList = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : value;

export class AnalyticsHistoryDto {
  @Type(() => Number)
  @IsIn(ANALYTICS_OVERVIEW_RANGES)
  days: (typeof ANALYTICS_OVERVIEW_RANGES)[number];

  // narrows the follower trend to one channel (the channel view)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  integration?: string;

  // best days and hours are bucketed in this timezone, empty means UTC
  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}

export class AnalyticsTopPostsDto {
  @Type(() => Number)
  @IsIn(ANALYTICS_OVERVIEW_RANGES)
  days: (typeof ANALYTICS_OVERVIEW_RANGES)[number];

  @IsOptional()
  @IsIn(TOP_POSTS_SORTS)
  sort?: (typeof TOP_POSTS_SORTS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  integrations?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  offset?: number;
}
