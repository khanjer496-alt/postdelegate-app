import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text: string;

  // shown next to the review only when the author consents
  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  roleCompany?: string;

  @IsOptional()
  @IsBoolean()
  consentToPublish?: boolean;
}
