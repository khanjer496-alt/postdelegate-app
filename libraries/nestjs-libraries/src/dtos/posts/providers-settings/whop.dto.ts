import { IsDefined, IsOptional, IsString, MinLength } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class WhopDto {
  @MinLength(1, { message: 'Choose a Whop company' })
  @IsDefined({ message: 'Choose a Whop company' })
  @IsString({ message: 'Choose a Whop company' })
  @JSONSchema({
    description: 'Company ID',
  })
  @ComposerOnly()
  company: string;

  @MinLength(1, { message: 'Choose a Whop forum' })
  @IsDefined({ message: 'Choose a Whop forum' })
  @IsString({ message: 'Choose a Whop forum' })
  @JSONSchema({
    description: 'Experience ID for the Whop forum',
  })
  @ComposerOnly()
  experience: string;

  @IsOptional()
  @IsString({ message: 'The title must be text' })
  title?: string;
}
