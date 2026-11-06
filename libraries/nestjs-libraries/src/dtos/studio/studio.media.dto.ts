import {
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StudioFocusDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';

// What the customer reads when a field is refused, like studio.clip.dto.ts.
// An item of a list names itself (studioLabel), so the message also says
// which one: "Slide 2: Pick a picture or video from your media library"
export const say = (message: string) => ({ message });
const MEDIA = say('Pick a picture or video from your media library');
const MEDIA_LINK = say('Pick the picture or video again');
const FOCUS = say('Drag the crop back onto the picture');

// A picture (png, jpg or webp) or a video of the media library, by id. The
// templates made of several of them build their items on it
export class StudioMediaDto {
  @IsDefined(MEDIA)
  @IsUUID(undefined, MEDIA)
  mediaId: string;

  // what the editor shows; the render never reads it, it finds the file of
  // the media id in our own storage
  @IsOptional()
  @IsString(MEDIA_LINK)
  @MaxLength(2000, MEDIA_LINK)
  path?: string;

  // where the vertical frame sits on the picture, 0 to 1 on each axis
  @IsOptional()
  @Type(() => StudioFocusDto)
  @ValidateNested(FOCUS)
  focus?: StudioFocusDto;
}
