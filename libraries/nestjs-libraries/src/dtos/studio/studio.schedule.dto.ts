import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BULK_VIDEO_CAPTION_LIMIT,
  BULK_VIDEO_CHANNEL_LIMIT,
  BULK_VIDEO_LIMIT,
  BulkVideoChannelDto,
} from '@gitroom/nestjs-libraries/dtos/posts/bulk.videos.dto';

// Finished Studio videos scheduled at once, with the limits of the bulk
// video upload: one post a video on every channel
export class StudioScheduleRendersDto {
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_VIDEO_LIMIT)
  @IsUUID('all', { each: true })
  renderIds: string[];

  // the channels, each with the settings its network asks for (a YouTube
  // title, for example)
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_VIDEO_CHANNEL_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => BulkVideoChannelDto)
  integrations: BulkVideoChannelDto[];

  // the text of every post
  @IsOptional()
  @IsString()
  @MaxLength(BULK_VIDEO_CAPTION_LIMIT)
  content?: string;

  @IsOptional()
  @IsIn(['schedule', 'draft'])
  type?: 'schedule' | 'draft';
}
