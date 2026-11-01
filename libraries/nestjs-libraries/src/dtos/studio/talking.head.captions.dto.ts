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
  @IsIn(['crop', 'blur'], { message: 'Pick Fill or Whole picture' })
  fit?: 'crop' | 'blur';

  @IsDefined({ message: 'Make the captions first' })
  @Type(() => StudioCaptionsDto)
  @ValidateNested({ message: 'Make the captions first' })
  captions: StudioCaptionsDto;
}
