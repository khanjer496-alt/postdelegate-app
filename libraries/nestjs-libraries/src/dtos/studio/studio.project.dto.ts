import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateStudioProjectDto {
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  // checked against the registered templates by the service
  @IsDefined()
  @IsString()
  @MaxLength(100)
  template: string;
}

export class UpdateStudioProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  // validated with the DTO of the project's template by the service; a draft
  // may still miss parts, the render validates it whole
  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;
}

export class StudioTranscribeDto {
  // a typed script: the words are spread over the clip, no AI key needed.
  // Without it the clip is transcribed with the workspace's own key
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  script?: string;
}
