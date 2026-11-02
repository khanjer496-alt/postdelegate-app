import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class HashnodeTagsSettings {
  @IsString({ message: 'Choose the tags from the list' })
  value: string;

  @IsString({ message: 'Choose the tags from the list' })
  label: string;
}

export class HashnodeSettingsDto {
  @IsString({ message: 'Add a title of at least 6 characters' })
  @MinLength(6, { message: 'Add a title of at least 6 characters' })
  @IsDefined({ message: 'Add a title of at least 6 characters' })
  title: string;

  // optional: an empty field, as the composer sends it, is no subtitle
  @IsString({ message: 'The subtitle must be at least 2 characters' })
  @MinLength(2, { message: 'The subtitle must be at least 2 characters' })
  @IsOptional()
  @ValidateIf((o) => !!o.subtitle)
  subtitle: string;

  @IsOptional()
  @ValidateNested({ message: 'Choose the cover picture from the media library' })
  @Type(() => MediaDto)
  main_image?: MediaDto;

  @IsOptional()
  @IsString({ message: 'Invalid URL' })
  @ValidateIf((o) => o.canonical && o.canonical.indexOf('(post:') === -1)
  @Matches(
    /^(|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})$/,
    {
      message: 'Invalid URL',
    }
  )
  canonical?: string;

  @IsString({ message: 'Choose a Hashnode publication' })
  @IsDefined({ message: 'Choose a Hashnode publication' })
  @ComposerOnly()
  publication?: string;

  @IsArray({ message: 'Add at least one tag' })
  @ArrayMinSize(1, { message: 'Add at least one tag' })
  @Type(() => HashnodeTagsSettings)
  @ValidateNested({ each: true, message: 'Choose the tags from the list' })
  @ComposerOnly()
  tags: HashnodeTagsSettings[];
}
