import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTagDto {
  @IsString()
  name: string;

  @IsString()
  color: string;

  // a plain tag, a campaign or a content pillar
  @IsOptional()
  @IsIn(['TAG', 'CAMPAIGN', 'PILLAR'])
  kind?: 'TAG' | 'CAMPAIGN' | 'PILLAR';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
