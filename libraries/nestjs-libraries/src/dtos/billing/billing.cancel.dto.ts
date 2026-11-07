import { IsIn, IsOptional, IsString } from 'class-validator';

export class BillingCancelDto {
  @IsOptional()
  @IsString()
  feedback?: string;

  // What the customer asked for. Without it the route keeps toggling, as it
  // always did, for clients that don't send it yet
  @IsOptional()
  @IsIn(['cancel', 'reactivate'])
  intent?: 'cancel' | 'reactivate';
}
