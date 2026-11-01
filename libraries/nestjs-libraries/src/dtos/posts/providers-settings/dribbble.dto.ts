import {
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class DribbbleDto {
  @IsString()
  @IsDefined()
  @MinLength(1, {
    message: 'Title is required',
  })
  title: string;

  // the Dribbble team id picked in the composer, empty for the user's own account
  @IsOptional()
  @IsString()
  @ValidateIf((o) => !!o.team)
  @Matches(/^\d+$/, { message: 'Choose a team from the list' })
  @ComposerOnly()
  team?: string;
}
