import { IsDefined, IsString, MinLength } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class SkoolDto {
  @MinLength(1)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Group must be an id',
  })
  @ComposerOnly()
  group: string;

  @MinLength(1)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Label must be an id',
  })
  @ComposerOnly()
  label: string;

  @MinLength(1)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Title of the post',
  })
  title: string;
}
