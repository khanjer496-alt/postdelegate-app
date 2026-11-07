import { IsEmail, IsString, MaxLength, ValidateIf } from 'class-validator';

export class AffiliatePayoutDto {
  // empty removes the payout details
  @IsString()
  @MaxLength(254)
  @ValidateIf((o) => !!o.payoutEmail)
  @IsEmail()
  payoutEmail: string;
}
