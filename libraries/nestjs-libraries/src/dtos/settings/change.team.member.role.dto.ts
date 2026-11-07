import { IsIn, IsString } from 'class-validator';

// Super Admin hands the workspace to another member, Admin is how an owner
// steps down afterwards
export class ChangeTeamMemberRoleDto {
  @IsString()
  @IsIn(['SUPERADMIN', 'ADMIN'])
  role: 'SUPERADMIN' | 'ADMIN';
}
