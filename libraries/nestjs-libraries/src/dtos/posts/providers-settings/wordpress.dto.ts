import {
  IsArray,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import { Type } from 'class-transformer';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class WordpressDto {
  @IsString({ message: 'Add a title of at least 2 characters' })
  @MinLength(2, { message: 'Add a title of at least 2 characters' })
  @IsDefined({ message: 'Add a title of at least 2 characters' })
  title: string;

  @IsOptional()
  @ValidateNested({ message: 'Choose the cover picture from the media library' })
  @Type(() => MediaDto)
  main_image?: MediaDto;

  @IsString({ message: 'Choose a post type' })
  @IsDefined({ message: 'Choose a post type' })
  // the picker starts on "--Select--", an empty value
  @MinLength(1, { message: 'Choose a post type' })
  @ComposerOnly()
  type: string;

  @IsOptional()
  @IsArray({ message: 'Choose the categories from the list' })
  @IsNumber({}, { each: true, message: 'Choose the categories from the list' })
  @ComposerOnly()
  categories?: number[];

  @IsOptional()
  @IsArray({ message: 'Choose the tags from the list' })
  @IsNumber({}, { each: true, message: 'Choose the tags from the list' })
  @ComposerOnly()
  tags?: number[];

  @IsOptional()
  @IsString({
    message: 'The status must be publish, draft, pending or private',
  })
  @IsIn(['publish', 'draft', 'pending', 'private'], {
    message: 'The status must be publish, draft, pending or private',
  })
  status?: string;
}
