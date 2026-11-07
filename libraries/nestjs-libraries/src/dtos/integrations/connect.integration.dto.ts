import {
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
} from 'class-validator';

export class ConnectIntegrationDto {
  @IsString()
  @IsDefined()
  state: string;

  @IsString()
  @IsDefined()
  code: string;

  @IsString()
  @IsDefined()
  timezone: string;

  @IsString()
  @IsOptional()
  refresh?: string;

  // the person opening a shared connect link confirmed the workspace it adds
  // their account to (see connect.binding)
  @IsBoolean()
  @IsOptional()
  confirmed?: boolean;
}
