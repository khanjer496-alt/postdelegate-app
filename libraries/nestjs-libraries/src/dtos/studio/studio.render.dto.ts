import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// A render in one call, for assistants and the public API: a project of the
// template is made with the spec and rendered the way the editor does it
export class CreateStudioRenderDto {
  // checked against the registered templates by the service
  @IsDefined()
  @IsString()
  @MaxLength(100)
  template: string;

  // the name of the project in Studio, the template's title when missing
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  // validated with the DTO of the template by the service. Media are ids of
  // the workspace's media library, never urls
  @IsDefined()
  @IsObject()
  spec: Record<string, unknown>;
}
