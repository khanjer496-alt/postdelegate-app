import {
  IsDefined,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class PinterestSettingsDto {
  @IsString()
  @ValidateIf((o) => !!o.title)
  @MaxLength(100)
  title: string;

  @IsString()
  @ValidateIf((o) => !!o.link)
  @IsUrl()
  link: string;

  @IsString()
  @ValidateIf((o) => !!o.dominant_color)
  dominant_color: string;

  @IsDefined({
    message: 'Board is required',
  })
  @IsString({
    message: 'Board is required',
  })
  @MinLength(1, {
    message: 'Board is required',
  })
  @Matches(/^\d+$/, {
    // the composer picks the id for the user, so lead with what to do there,
    // and keep the id hint an API, CLI or agent caller needs - a validation
    // failure returns this message, never the schema description
    message: 'Please choose a board from the list (the numeric board id)',
  })
  @JSONSchema({
    description:
      'The numeric id of the board (from the boards list of the channel), not the board name',
  })
  @ComposerOnly()
  board: string;
}
