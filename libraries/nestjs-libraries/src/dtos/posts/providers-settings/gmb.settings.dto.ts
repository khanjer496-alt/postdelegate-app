import { IsOptional, IsString, IsIn, IsUrl, ValidateIf } from 'class-validator';

export class GmbSettingsDto {
  @IsOptional()
  @IsIn(['STANDARD', 'EVENT', 'OFFER'])
  topicType?: 'STANDARD' | 'EVENT' | 'OFFER';

  @IsOptional()
  @IsIn([
    'NONE',
    'BOOK',
    'ORDER',
    'SHOP',
    'LEARN_MORE',
    'SIGN_UP',
    'GET_OFFER',
    'CALL',
  ])
  callToActionType?:
    | 'NONE'
    | 'BOOK'
    | 'ORDER'
    | 'SHOP'
    | 'LEARN_MORE'
    | 'SIGN_UP'
    | 'GET_OFFER'
    | 'CALL';

  // CALL dials the phone number of the profile, NONE has no button
  @IsOptional()
  @ValidateIf(
    (o) => o.callToActionType && !['NONE', 'CALL'].includes(o.callToActionType)
  )
  @IsUrl()
  callToActionUrl?: string;

  // Event-specific fields, offers reuse the title and dates
  @IsOptional()
  @ValidateIf((o) => o.topicType === 'EVENT' || o.topicType === 'OFFER')
  @IsString()
  eventTitle?: string;

  @IsOptional()
  @IsString()
  eventStartDate?: string;

  @IsOptional()
  @IsString()
  eventEndDate?: string;

  @IsOptional()
  @IsString()
  eventStartTime?: string;

  @IsOptional()
  @IsString()
  eventEndTime?: string;

  // Offer-specific fields
  @IsOptional()
  @IsString()
  offerCouponCode?: string;

  @IsOptional()
  @ValidateIf((o) => o.offerRedeemUrl)
  @IsUrl()
  offerRedeemUrl?: string;

  @IsOptional()
  @IsString()
  offerTerms?: string;
}
