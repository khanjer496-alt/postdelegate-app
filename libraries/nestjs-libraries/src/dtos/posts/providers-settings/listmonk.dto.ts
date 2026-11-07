import { IsOptional, IsString, MinLength } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class ListmonkDto {
  @IsString({ message: 'Add a subject for the email' })
  @MinLength(1, { message: 'Add a subject for the email' })
  subject: string;

  @IsString({ message: 'Add a preview text for the email' })
  preview: string;

  @IsString({ message: 'Choose a list to send the email to' })
  // the picker starts on "--Select--", an empty value
  @MinLength(1, { message: 'Choose a list to send the email to' })
  @JSONSchema({
    description: 'List must be an id',
  })
  @ComposerOnly()
  list: string;

  @IsString({ message: 'Choose a template from the list' })
  @IsOptional()
  @JSONSchema({
    description: 'Template must be an id',
  })
  @ComposerOnly()
  template: string;
}
