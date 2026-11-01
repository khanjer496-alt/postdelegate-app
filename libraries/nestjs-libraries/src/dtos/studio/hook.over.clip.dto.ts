import { IsDefined, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import {
  StudioClipDto,
  StudioHookDto,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';

// "Hook over clip": a trimmed clip filling the vertical frame, with a hook
// line popping in over it
export class HookOverClipDto extends StudioClipDto {
  @IsDefined()
  @Type(() => StudioHookDto)
  @ValidateNested()
  hook: StudioHookDto;
}
