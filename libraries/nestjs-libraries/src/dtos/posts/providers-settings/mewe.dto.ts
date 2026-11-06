import { IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class MeweDto {
  @IsIn(['timeline', 'group'])
  @JSONSchema({
    description: 'Where to post: timeline or group',
  })
  postType: 'timeline' | 'group';

  @ValidateIf((o) => o.postType === 'group')
  @MinLength(1)
  @IsString()
  @JSONSchema({
    description: 'Group must be an id',
  })
  @IsOptional()
  @ComposerOnly()
  group?: string;
}
