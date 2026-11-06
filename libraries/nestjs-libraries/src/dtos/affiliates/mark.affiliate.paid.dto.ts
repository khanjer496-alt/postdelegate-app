import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class MarkAffiliatePaidDto {
  // the total the admin saw and paid, the request is rejected when the
  // payable total moved in the meantime
  @IsInt()
  @Min(1)
  expectedAmountCents: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}
