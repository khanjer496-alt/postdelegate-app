import { IsBoolean, ValidateIf } from 'class-validator';

export class EmailNotificationsDto {
  @IsBoolean()
  sendSuccessEmails: boolean;

  @IsBoolean()
  sendFailureEmails: boolean;

  @IsBoolean()
  sendStreakEmails: boolean;

  // optional for older clients, but null is rejected like the other fields
  @ValidateIf((o) => o.sendOnboardingEmails !== undefined)
  @IsBoolean()
  sendOnboardingEmails?: boolean;
}
