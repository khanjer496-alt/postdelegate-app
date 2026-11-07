import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AppAbility,
  PermissionsService,
} from '@gitroom/backend/services/auth/permissions/permissions.service';
import {
  AbilityPolicy,
  CHECK_POLICIES_KEY,
} from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { Organization } from '@prisma/client';
import { Request } from 'express';
import { Sections, SubscriptionException } from './permission.exception.class';

// Routes that run before there is an organization on the request. Matched on
// whole path segments from the start, a path that merely contains one of
// these (/oauth/authorize, /whatever/auth/x) is still checked.
// /integrations/social-connect is the OAuth callback: it has no session, the
// connect binding of its state decides who may finish it (connect.binding)
// and the controller checks the plan's channel limit itself.
// /integrations/provider (the page pick that ends a connect) has an
// organization, but whether it adds a channel depends on the page picked - a
// page that already is a connected channel adds none - so the plan's channel
// limit is checked by IntegrationService.saveProviderPage, which also covers
// the session-less /integrations/public/provider route
const skippedPrefixes = [
  '/auth',
  '/integrations/social-connect',
  '/integrations/provider',
];

export const isUnderPrefix = (path: string, prefix: string) =>
  path === prefix || path.startsWith(prefix + '/');

@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private _reflector: Reflector,
    private _authorizationService: PermissionsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    if (skippedPrefixes.some((prefix) => isUnderPrefix(request.path, prefix))) {
      return true;
    }

    const policyHandlers =
      this._reflector.get<AbilityPolicy[]>(
        CHECK_POLICIES_KEY,
        context.getHandler()
      ) || [];

    if (!policyHandlers || !policyHandlers.length) {
      return true;
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const { org }: { org: Organization } = request;

    const refreshChannelId = typeof request.query?.refresh === 'string' ? request.query.refresh : undefined;

    // @ts-ignore
    const ability = await this._authorizationService.check(org.id, org.createdAt, org.users[0].role, policyHandlers, refreshChannelId);

    const item = policyHandlers.find(
      (handler) => !this.execPolicyHandler(handler, ability)
    );

    if (item) {
      // the offer is a nicer prompt, never a reason to fail the plain 402
      const extraChannels =
        item[1] === Sections.CHANNEL
          ? await this._authorizationService
              .extraChannelsOffer(org)
              .catch(() => null)
          : null;
      const message =
        item[1] === Sections.CHANNEL
          ? await this._authorizationService
              .channelLimitMessage(org.id)
              .catch((): undefined => undefined)
          : undefined;
      throw new SubscriptionException({
        section: item[1],
        action: item[0],
        ...(extraChannels ? { extraChannels } : {}),
        ...(message ? { message } : {}),
      });
    }

    return true;
  }

  private execPolicyHandler(handler: AbilityPolicy, ability: AppAbility) {
    return ability.can(handler[0], handler[1]);
  }
}
