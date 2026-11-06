import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportPostsDto {
  // the CSV file contents
  @IsDefined()
  @IsString()
  @MaxLength(1_000_000)
  csv: string;

  // the timezone of the dates of rows without a timezone column
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
