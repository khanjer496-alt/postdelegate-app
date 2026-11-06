import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Shown to the customer as they are, like the messages of the spec DTOs
const NAME = { message: 'Give the project a name' };
const NAME_LONG = { message: 'Project names are 100 characters at most' };
const SCRIPT = { message: 'Type the script first' };
const SCRIPT_LONG = { message: 'The script is 3,000 characters at most' };

export class CreateStudioProjectDto {
  @IsDefined(NAME)
  @IsString(NAME)
  @MinLength(1, NAME)
  @MaxLength(100, NAME_LONG)
  name: string;

  // checked against the registered templates by the service
  @IsDefined({ message: 'Pick a template' })
  @IsString({ message: 'Pick a template' })
  @MaxLength(100, { message: 'Pick a template' })
  template: string;
}

export class UpdateStudioProjectDto {
  @IsOptional()
  @IsString(NAME)
  @MinLength(1, NAME)
  @MaxLength(100, NAME_LONG)
  name?: string;

  // validated with the DTO of the project's template by the service; a draft
  // may still miss parts, the render validates it whole
  @IsOptional()
  @IsObject({ message: 'The project settings are not valid' })
  spec?: Record<string, unknown>;
}

export class StudioTranscribeDto {
  // a typed script: the words are spread over the clip, no AI key needed.
  // Without it the clip is transcribed with the workspace's own key
  @IsOptional()
  @IsString(SCRIPT)
  @MinLength(1, SCRIPT)
  @MaxLength(3000, SCRIPT_LONG)
  script?: string;
}

export class GetStudioProjectsDto {
  // also list the projects assistants and the public API made
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  api?: boolean;
}
