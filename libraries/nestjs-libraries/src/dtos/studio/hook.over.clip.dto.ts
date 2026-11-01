import { IsDefined, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import {
  STUDIO_HOOK_MISSING,
  StudioClipDto,
  StudioHookDto,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';

// "Hook over clip": a trimmed clip filling the vertical frame, with a hook
// line popping in over it
export class HookOverClipDto extends StudioClipDto {
  @IsDefined({ message: STUDIO_HOOK_MISSING })
  @Type(() => StudioHookDto)
  @ValidateNested({ message: STUDIO_HOOK_MISSING })
  hook: StudioHookDto;
}
