import {
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Provider } from '@prisma/client';
import { Transform } from 'class-transformer';
import { parseReferralCode } from '@gitroom/helpers/affiliate/affiliate.cookie';

export class CreateOrgUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @IsDefined()
  @ValidateIf((o) => !o.providerToken)
  password: string;

  @IsString()
  @IsDefined()
  provider: Provider;

  @IsString()
  @IsDefined()
  @ValidateIf((o) => !o.password)
  providerToken: string;

  @IsEmail()
  @IsDefined()
  @ValidateIf((o) => !o.providerToken)
  email: string;

  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(128)
  company: string;

  datafast_visitor_id: string;

  // the ?ref= code of the sign-up page, sent when the visitor did not allow
  // the referral cookie. A malformed value is dropped here, never refused, so
  // it can't fail the sign-up
  @Transform(({ value }) =>
    typeof value === 'string' ? parseReferralCode(value) : undefined
  )
  @IsOptional()
  @IsString()
  ref?: string;
}
