import { IsDefined, IsString, Matches } from 'class-validator';
import { AFFILIATE_CODE_REGEX } from '@gitroom/helpers/affiliate/affiliate.cookie';

export class SetAffiliateCodeDto {
  @IsString()
  @IsDefined()
  @Matches(AFFILIATE_CODE_REGEX, {
    message:
      'The code must be 3 to 24 characters: lowercase letters, numbers and hyphens',
  })
  code: string;
}
