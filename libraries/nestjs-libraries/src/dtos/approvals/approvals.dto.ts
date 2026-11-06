import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ArrayMinSize,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateApprovalSettingsDto {
  @IsBoolean()
  requireApproval: boolean;

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  approverIds: string[];

  @IsBoolean()
  requireAgentApproval: boolean;

  // posts from the public API and the CLI also wait, with requireAgentApproval
  @IsOptional()
  @IsBoolean()
  requireApiApproval?: boolean;

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  agentIntegrationIds: string[];

  // null or missing means no daily limit
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  agentMaxPostsPerDay?: number | null;
}

export class ApprovalCommentDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class RequestChangesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment: string;
}

export class ReviewQueueDto {
  @IsOptional()
  @IsIn(['all', 'agent'])
  source?: 'all' | 'agent';
}

export class ActivityListDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(0)
  @Max(10000)
  page?: number;

  @IsOptional()
  @IsString()
  postId?: string;
}

export class CreateApprovalLinkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  postIds: string[];

  @IsInt()
  @IsIn([1, 3, 7, 14, 30])
  expiresInDays: number;
}

export class ClientApprovalDto {
  @IsString()
  postId: string;

  @IsIn(['approve', 'request_changes'])
  decision: 'approve' | 'request_changes';

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
