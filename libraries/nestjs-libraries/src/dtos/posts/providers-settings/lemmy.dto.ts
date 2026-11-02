import {
  ArrayMinSize,
  IsDefined,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

// the field names keep "subreddit" for the posts already saved, Lemmy calls
// them communities
export class LemmySettingsDtoInner {
  @IsString({ message: 'Choose a Lemmy community' })
  @MinLength(2, { message: 'Choose a Lemmy community' })
  @IsDefined({ message: 'Choose a Lemmy community' })
  subreddit: string;

  @IsString({ message: 'Choose a Lemmy community' })
  @IsDefined({ message: 'Choose a Lemmy community' })
  id: string;

  @IsString({ message: 'Add a title of at least 2 characters' })
  @MinLength(2, { message: 'Add a title of at least 2 characters' })
  @IsDefined({ message: 'Add a title of at least 2 characters' })
  title: string;

  @ValidateIf((o) => o.url)
  @IsOptional()
  @IsUrl({}, { message: 'Enter a full link, like https://example.com' })
  url: string;
}

export class LemmySettingsValueDto {
  @Type(() => LemmySettingsDtoInner)
  @IsDefined({ message: 'Choose a Lemmy community' })
  @ValidateNested({ message: 'Choose a Lemmy community' })
  value: LemmySettingsDtoInner;
}

export class LemmySettingsDto {
  @Type(() => LemmySettingsValueDto)
  @ValidateNested({ each: true, message: 'Choose a Lemmy community' })
  @ArrayMinSize(1, { message: 'Add at least one Lemmy community' })
  @ComposerOnly()
  subreddit: LemmySettingsValueDto[];
}
