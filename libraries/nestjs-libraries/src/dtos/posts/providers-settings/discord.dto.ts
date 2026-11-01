import { IsDefined, IsString, MinLength } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class DiscordDto {
  @MinLength(1)
  @IsDefined()
  @IsString()
    @JSONSchema({
    description: 'Channel must be an id',
  })
  @ComposerOnly()
  channel: string;
}
