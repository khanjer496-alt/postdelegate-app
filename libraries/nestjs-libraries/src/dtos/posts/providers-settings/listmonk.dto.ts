import { IsOptional, IsString, MinLength } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class ListmonkDto {
  @IsString()
  @MinLength(1)
  subject: string;

  @IsString()
  preview: string;

  @IsString()
  @JSONSchema({
    description: 'List must be an id',
  })
  @ComposerOnly()
  list: string;

  @IsString()
  @IsOptional()
  @JSONSchema({
    description: 'Template must be an id',
  })
  @ComposerOnly()
  template: string;
}
