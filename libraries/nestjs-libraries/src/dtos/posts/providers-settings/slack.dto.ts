import { IsDefined, IsString, MinLength } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class SlackDto {
  @MinLength(1, { message: 'Choose a Slack channel' })
  @IsDefined({ message: 'Choose a Slack channel' })
  @IsString({ message: 'Choose a Slack channel' })
  @JSONSchema({
    description: 'Channel must be an id',
  })
  @ComposerOnly()
  channel: string;
}
