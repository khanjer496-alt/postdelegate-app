import { Type } from 'class-transformer';
import { IsString, ValidateNested } from 'class-validator';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

export class FarcasterId {
  @IsString()
  id: string;
}
export class FarcasterValue {
  @ValidateNested()
  @Type(() => FarcasterId)
  value: FarcasterId;
}
export class FarcasterDto {
  @ValidateNested({ each: true })
  @Type(() => FarcasterValue)
  @ComposerOnly()
  subreddit: FarcasterValue[];
}
