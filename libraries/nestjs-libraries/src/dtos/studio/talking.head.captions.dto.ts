import { IsDefined, IsIn, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import {
  StudioCaptionsDto,
  StudioClipDto,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';

// "Talking head + captions": the clip with burned-in captions that light up
// word by word
export class TalkingHeadCaptionsDto extends StudioClipDto {
  // "crop" fills the frame and cuts the sides, "blur" keeps the whole picture
  // over a blurred copy of itself
  @IsOptional()
  @IsIn(['crop', 'blur'])
  fit?: 'crop' | 'blur';

  @IsDefined()
  @Type(() => StudioCaptionsDto)
  @ValidateNested()
  captions: StudioCaptionsDto;
}
