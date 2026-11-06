import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';

export const ideaStatuses = ['IDEA', 'DRAFTING', 'USED'] as const;

export class CreateIdeaDto {
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Type(() => MediaDto)
  @ValidateNested({ each: true })
  media?: MediaDto[];

  // a campaign, pillar or tag of this workspace
  @IsOptional()
  @IsString()
  tagId?: string | null;

  @IsOptional()
  @IsIn(ideaStatuses)
  status?: (typeof ideaStatuses)[number];
}

export class UpdateIdeaDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Type(() => MediaDto)
  @ValidateNested({ each: true })
  media?: MediaDto[];

  @IsOptional()
  @IsString()
  tagId?: string | null;

  @IsOptional()
  @IsIn(ideaStatuses)
  status?: (typeof ideaStatuses)[number];
}
