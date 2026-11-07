import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class ChangePostStatusDto {
  @IsIn(['draft', 'schedule'])
  status: 'draft' | 'schedule';

  // the explicit opt-in to change a post that was already published, or is
  // being published right now, which can publish it again
  @IsOptional()
  @IsBoolean()
  republish?: boolean;
}
