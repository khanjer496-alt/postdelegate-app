import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { Organization } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private _organizationService: OrganizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Operator-only routes (user search, debug views, credit resets) do not
    // exist unless ENABLE_SUPER_ADMIN_API=true, whoever calls them
    if (process.env.ENABLE_SUPER_ADMIN_API !== 'true') {
      throw new NotFoundException();
    }

    const request: Request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const {
      org,
      isOAuthApp,
      authOrgId,
    }: { org: Organization; isOAuthApp?: boolean; authOrgId?: string } =
      request;

    const orgId = authOrgId || org?.id;

    if (
      !orgId ||
      isOAuthApp ||
      !(await this._organizationService.canUseSuperAdminApi(orgId))
    ) {
      throw new HttpException({ msg: 'Unauthorized' }, 403);
    }

    return true;
  }
}
