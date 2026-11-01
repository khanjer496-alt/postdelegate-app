import { IsDefined, IsOptional, IsString, MinLength } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class WhopDto {
  @MinLength(1)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Company ID',
  })
  @ComposerOnly()
  company: string;

  @MinLength(1)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Experience ID for the Whop forum',
  })
  @ComposerOnly()
  experience: string;

  @IsOptional()
  @IsString()
  title?: string;
}
