import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class EvergreenDto {
  // re-share every N days (a week is 7)
  @IsInt()
  @Min(1)
  @Max(365)
  intervalInDays: number;

  // how many times to re-share after the first publish, empty for no limit
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxShares?: number | null;

  // stop re-sharing after this date, empty for no end date
  @IsOptional()
  @IsDateString()
  until?: string | null;

  // other wordings used in turn with the original text
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(5000, { each: true })
  variants?: string[];
}
