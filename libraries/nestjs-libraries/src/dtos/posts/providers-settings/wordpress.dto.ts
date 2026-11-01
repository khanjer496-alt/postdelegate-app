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
  @IsString()
  @MinLength(2)
  @IsDefined()
  title: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  main_image?: MediaDto;

  @IsString()
  @IsDefined()
  @ComposerOnly()
  type: string;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @ComposerOnly()
  categories?: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @ComposerOnly()
  tags?: number[];

  @IsOptional()
  @IsString()
  @IsIn(['publish', 'draft', 'pending', 'private'])
  status?: string;
}
