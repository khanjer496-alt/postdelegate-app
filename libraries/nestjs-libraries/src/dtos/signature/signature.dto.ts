import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SignatureType } from '@prisma/client';

export class SignatureDto {
  @IsString()
  @IsDefined()
  content: string;

  @IsBoolean()
  @IsDefined()
  autoAdd: boolean;

  // set on creation only, a signature stays a signature and a template a template
  @IsEnum(SignatureType)
  @IsOptional()
  type?: SignatureType;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string;
}
