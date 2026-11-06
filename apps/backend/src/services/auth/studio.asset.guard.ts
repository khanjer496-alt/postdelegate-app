import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { Organization } from '@prisma/client';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';

// Runs before the upload interceptor of POST /studio/assets, so a workspace
// without a plan or out of room for music never has a file stored at all
@Injectable()
export class StudioAssetGuard implements CanActivate {
  constructor(private _studioService: StudioService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const { org }: { org: Organization } = request;
    await this._studioService.checkAssetAllowed(org.id);
    return true;
  }
}
