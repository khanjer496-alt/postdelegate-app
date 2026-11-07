import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { IntegrationFunctionDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.function.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { IntegrationNameDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.name.dto';
import { CustomerNameDto } from '@gitroom/nestjs-libraries/dtos/integrations/customer.name.dto';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import {
  Disconnect,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

import { timer } from '@gitroom/helpers/utils/timer';
import { TelegramProvider } from '@gitroom/nestjs-libraries/integrations/social/telegram.provider';
import { MoltbookProvider } from '@gitroom/nestjs-libraries/integrations/social/moltbook.provider';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { uniqBy } from 'lodash';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { channelState } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';
import {
  ConnectBindingType,
  connectNonceCookie,
  connectNonceCookieOptions,
  deleteConnectBinding,
  readConnectBinding,
  saveConnectBinding,
} from '@gitroom/nestjs-libraries/integrations/connect.binding';

// Where a connect may send the person after the platform's consent screen:
// only back to us - an address on the app's own origin, or the mobile app's
// scheme (MOBILE_APP_SCHEME, `postiz:` by default). Anything else would turn
// a real consent screen into a step towards a phishing page, so it is
// dropped and the connect ends on the usual page instead
export const allowedConnectRedirect = (redirectUrl?: string) => {
  if (!redirectUrl) {
    return undefined;
  }
  try {
    const url = new URL(redirectUrl);
    if (url.username || url.password) {
      return undefined;
    }
    if (
      process.env.FRONTEND_URL &&
      url.origin === new URL(process.env.FRONTEND_URL).origin
    ) {
      return redirectUrl;
    }
    const appSchemes = [
      'postiz:',
      new URL(process.env.MOBILE_APP_SCHEME || 'postiz://auth/callback')
        .protocol,
    ].filter((scheme) => !['http:', 'https:'].includes(scheme));
    return appSchemes.includes(url.protocol) ? redirectUrl : undefined;
  } catch {
    return undefined;
  }
};

@ApiTags('Integrations')
@Controller('/integrations')
export class IntegrationsController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _postService: PostsService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  // The policy guard skips /integrations/provider (the limit depends on the
  // picked page), saveProviderPage checks the plan's channel limit itself
  @Post('/provider/:id/connect')
  async saveProviderPage(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: any,
    @Res({ passthrough: true }) res: Response
  ) {
    // the state of the connect this page ends, which the app sends along
    const state =
      typeof body?.state === 'string' && body.state ? body.state : undefined;
    const binding = state ? await readConnectBinding(state) : undefined;

    // a connect started for another workspace never ends in this one
    if (binding && binding.orgId !== org.id) {
      throw new HttpException(
        'This connection was started in another workspace. Switch to that workspace and connect the channel again.',
        403
      );
    }

    const saved = await this._integrationService.saveProviderPage(
      org.id,
      id,
      body,
      // @ts-ignore
      org?.subscription?.totalChannels || pricing.FREE.channel
    );

    // the connect is over: its state is spent, the binding after the
    // organization (see NoAuthIntegrationsController.spendConnectBinding)
    if (state && binding) {
      await ioRedis.del(`organization:${state}`);
      await deleteConnectBinding(state);
      if (binding.type === 'session') {
        res.cookie(connectNonceCookie(state), '', connectNonceCookieOptions(-1));
      }
    }

    return saved;
  }

  @Get('/:identifier/internal-plugs')
  getInternalPlugs(@Param('identifier') identifier: string) {
    return this._integrationManager.getInternalPlugs(identifier);
  }

  @Get('/customers')
  getCustomers(@GetOrgFromRequest() org: Organization) {
    return this._integrationService.customers(org.id);
  }

  @Put('/customers/:id')
  async updateCustomerName(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: CustomerNameDto
  ) {
    return this._integrationService.updateCustomerName(org.id, id, body.name);
  }

  @Put('/:id/group')
  async updateIntegrationGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { group: string }
  ) {
    return this._integrationService.updateIntegrationGroup(
      org.id,
      id,
      body.group
    );
  }

  @Put('/:id/customer-name')
  async updateOnCustomerName(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { name: string }
  ) {
    return this._integrationService.updateOnCustomerName(org.id, id, body.name);
  }

  @Put('/:id/custom-name')
  async updateCustomName(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: IntegrationNameDto
  ) {
    return this._integrationService.updateCustomName(org.id, id, body.name);
  }

  // The add-channel list of the signed-in workspace: the no-auth GET
  // /integrations has no org, so only this one can include the hidden
  // providers for PREVIEW_PROVIDER_ORGS.
  @Get('/available')
  getAvailableIntegrations(@GetOrgFromRequest() org: Organization) {
    return this._integrationManager.getAllIntegrations(org.id);
  }

  @Get('/list')
  async getIntegrationList(@GetOrgFromRequest() org: Organization) {
    return {
      integrations: await Promise.all(
        (
          await this._integrationService.getIntegrationsList(org.id)
        ).map(async (p) => {
          const findIntegration = this._integrationManager.getSocialIntegration(
            p.providerIdentifier
          );
          return {
            name: p.customName || p.name,
            originalName: p.name,
            id: p.id,
            internalId: p.internalId,
            disabled: p.disabled,
            // why it is off: 'USER', 'PLAN_LIMIT' or null (unknown)
            disabledReason: p.disabledReason,
            editor: findIntegration.editor,
            stripLinks: !!findIntegration?.stripLinks?.(),
            picture: p.picture || '/no-picture.jpg',
            identifier: p.providerIdentifier,
            dataDeletionNotice: findIntegration.authorizationPolicy?.deletionNotice,
            inBetweenSteps: p.inBetweenSteps,
            refreshNeeded: p.refreshNeeded,
            // what those two flags and `disabled` mean together, decided in
            // one place so every screen says the same thing about a channel
            state: channelState(p),
            isCustomFields: !!findIntegration.customFields,
            ...(findIntegration.customFields
              ? { customFields: await findIntegration.customFields() }
              : {}),
            display: p.profile,
            type: p.type,
            time: JSON.parse(p.postingTimes),
            changeProfilePicture: !!findIntegration?.changeProfilePicture,
            changeNickName: !!findIntegration?.changeNickname,
            recentPosts: !!findIntegration?.recentPosts,
            customer: p.customer,
            additionalSettings: p.additionalSettings || '[]',
          };
        })
      ),
    };
  }

  @Post('/:id/settings')
  async updateProviderSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('additionalSettings') body: string
  ) {
    if (typeof body !== 'string') {
      throw new Error('Invalid body');
    }

    await this._integrationService.updateProviderSettings(org.id, id, body);
  }
  @Post('/:id/nickname')
  async setNickname(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { name: string; picture: string }
  ) {
    const integration = await this._integrationService.getActiveIntegrationById(
      org.id,
      id
    );
    if (!integration) {
      throw new Error('Invalid integration');
    }

    const manager = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!manager.changeProfilePicture && !manager.changeNickname) {
      throw new Error('Invalid integration');
    }

    const { url } = manager.changeProfilePicture
      ? await manager.changeProfilePicture(
          integration.internalId,
          integration.token,
          body.picture
        )
      : { url: '' };

    const { name } = manager.changeNickname
      ? await manager.changeNickname(
          integration.internalId,
          integration.token,
          body.name
        )
      : { name: '' };

    return this._integrationService.updateNameAndUrl(id, name, url);
  }

  @Get('/:id')
  getSingleIntegration(
    @Param('id') id: string,
    @Query('order') order: string,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    return this._integrationService.getIntegrationForOrder(
      id,
      order,
      user.id,
      org.id
    );
  }

  @Get('/social/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') refresh: string,
    @Query('externalUrl') externalUrl: string,
    @Query('redirectUrl') redirectUrl: string,
    @Query('onboarding') onboarding: string,
    @GetOrgFromRequest() org: Organization,
    // "Send Invite Link to a customer": the link is opened by someone else
    @Query('invite') invite: string,
    @GetUserFromRequest() user: User,
    @Res({ passthrough: true }) res: Response
  ) {
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new Error('Integration not allowed');
    }

    await this._integrationService.checkProviderAvailable(
      org.id,
      integration,
      refresh
    );

    // A provider migrated via MIGRATE_PROVIDERS reconnects through its target
    // provider's OAuth: the callback lands on the target and the channel is
    // migrated in place (see migrateIntegration).
    const migrateTo = refresh
      ? this._integrationManager.getMigrationTarget(integration)
      : undefined;

    const integrationProvider = this._integrationManager.getSocialIntegration(
      migrateTo || integration
    );

    if (integrationProvider.externalUrl && !externalUrl) {
      throw new Error('Missing external url');
    }

    try {
      const getExternalUrl = integrationProvider.externalUrl
        ? {
            ...(await integrationProvider.externalUrl(externalUrl)),
            instanceUrl: externalUrl,
          }
        : undefined;

      const { codeVerifier, state, url } =
        await integrationProvider.generateAuthUrl(getExternalUrl);

      const returnTo = allowedConnectRedirect(redirectUrl);

      // Who may finish this connect (see connect.binding): an invite link is
      // for someone else, a mobile connect finishes in the system browser,
      // everything else in this browser, tied to it by a nonce cookie
      const type: ConnectBindingType =
        invite === 'true'
          ? 'invite'
          : returnTo &&
            !['http:', 'https:'].includes(new URL(returnTo).protocol)
          ? 'mobile'
          : 'session';
      const { nonce, ttl } = await saveConnectBinding(state, {
        type,
        orgId: org.id,
        userId: user.id,
      });

      if (refresh) {
        await ioRedis.set(`refresh:${state}`, refresh, 'EX', ttl);
      }

      if (onboarding === 'true') {
        await ioRedis.set(`onboarding:${state}`, 'true', 'EX', ttl);
      }

      if (returnTo) {
        await ioRedis.set(`redirect:${state}`, returnTo, 'EX', ttl);
      }

      await ioRedis.set(`organization:${state}`, org.id, 'EX', ttl);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', ttl);
      await ioRedis.set(
        `external:${state}`,
        JSON.stringify(getExternalUrl),
        'EX',
        ttl
      );

      if (nonce) {
        res.cookie(
          connectNonceCookie(state),
          nonce,
          connectNonceCookieOptions(ttl)
        );
      }

      return { url };
    } catch (err) {
      return { err: true };
    }
  }

  @Post('/:id/time')
  async setTime(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: IntegrationTimeDto
  ) {
    return this._integrationService.setTimes(org.id, id, body);
  }

  @Post('/mentions')
  async mentions(
    @GetOrgFromRequest() org: Organization,
    @Body() body: IntegrationFunctionDto
  ) {
    const getIntegration = await this._integrationService.getActiveIntegrationById(
      org.id,
      body.id
    );
    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    let newList: any[] | { none: true } = [];
    try {
      newList =
        (await this.functionIntegration(org, { ...body, name: 'mention' })) ||
        [];
    } catch (err) {
      console.log(err);
    }

    if (!Array.isArray(newList) && newList?.none) {
      return newList;
    }

    const list = await this._integrationService.getMentions(
      getIntegration.providerIdentifier,
      body?.data?.query
    );

    if (Array.isArray(newList) && newList.length) {
      await this._integrationService.insertMentions(
        getIntegration.providerIdentifier,
        newList
          .map((p: any) => ({
            name: p.label || '',
            username: p.id || '',
            image: p.image || '',
            doNotCache: p.doNotCache || false,
          }))
          .filter((f: any) => f.name && !f.doNotCache)
      );
    }

    return uniqBy(
      [
        ...list.map((p) => ({
          id: p.username,
          image: p.image,
          label: p.name,
        })),
        ...(newList as any[]),
      ],
      (p) => p.id
    ).filter((f) => f.label && f.id);
  }

  @Post('/function')
  async functionIntegration(
    @GetOrgFromRequest() org: Organization,
    @Body() body: IntegrationFunctionDto
  ): Promise<any> {
    const getIntegration = await this._integrationService.getIntegrationForFunction(
      org.id,
      body.id
    );
    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );
    if (!integrationProvider) {
      throw new Error('Invalid provider');
    }

    if (
      this._integrationManager.isDashboardCallable(
        integrationProvider,
        body.name
      )
    ) {
      try {
        // @ts-ignore
        const load = await integrationProvider[body.name](
          getIntegration.token,
          body.data,
          getIntegration.internalId,
          getIntegration
        );

        return load;
      } catch (err) {
        // The platform will keep rejecting this channel until the user
        // re-connects it: mark it as needing a refresh instead of retrying.
        if (err instanceof Disconnect) {
          await this._integrationService.disconnectChannel(
            org.id,
            getIntegration
          );
          return false;
        }

        if (err instanceof RefreshToken) {
          const data = await this._refreshIntegrationService.refresh(
            getIntegration
          );

          if (!data) {
            return;
          }

          const { accessToken } = data;

          if (accessToken) {
            if (integrationProvider.refreshWait) {
              await timer(10000);
            }
            return this.functionIntegration(org, body);
          }

          return false;
        }

        return false;
      }
    }
    throw new Error('Function not found');
  }

  @Post('/disable')
  disableChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    return this._integrationService.disableChannel(org.id, id);
  }

  @Post('/enable')
  enableChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    return this._integrationService.enableChannel(
      org.id,
      // @ts-ignore
      org?.subscription?.totalChannels || pricing.FREE.channel,
      id
    );
  }

  @Delete('/')
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    // The lifecycle gate must accept removal before any post is changed.
    const result = await this._integrationService.deleteChannel(org.id, id);
    const isTherePosts = await this._integrationService.getPostsForChannel(
      org.id,
      id
    );
    if (isTherePosts.length) {
      for (const post of isTherePosts) {
        this._postService.deletePost(org.id, post.group).catch((err) => {});
      }
    }

    return result;
  }

  @Get('/plug/list')
  async getPlugList() {
    return { plugs: this._integrationManager.getAllPlugs() };
  }

  @Get('/:id/plugs')
  async getPlugsByIntegrationId(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization
  ) {
    return this._integrationService.getPlugsByIntegrationId(org.id, id);
  }

  @Post('/:id/plugs')
  async postPlugsByIntegrationId(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @Body() body: PlugDto
  ) {
    return this._integrationService.createOrUpdatePlug(org.id, id, body);
  }

  @Put('/plugs/:id/activate')
  async changePlugActivation(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @Body('status') status: boolean
  ) {
    return this._integrationService.changePlugActivation(org.id, id, status);
  }

  @Get('/telegram/updates')
  async getUpdates(@Query() query: { word: string; id?: number }) {
    return new TelegramProvider().getBotId(query);
  }

  @Post('/moltbook/register')
  async moltbookRegister(@Body() body: { name: string; description: string }) {
    try {
      const provider = new MoltbookProvider();
      const result = await provider.registerAgent(body.name, body.description);
      return {
        apiKey: result.api_key,
        claimUrl: result.claim_url,
        verificationCode: result.verification_code,
      };
    } catch (err: any) {
      return { error: err.message || 'Registration failed' };
    }
  }

  // the API key travels in the body: a query string ends up in access logs
  @Post('/moltbook/status')
  async moltbookStatus(@Body() body: { apiKey: string }) {
    const apiKey = body?.apiKey;
    try {
      const provider = new MoltbookProvider();
      const result = await provider.checkAgentStatus(apiKey);
      return { claimed: result?.status === 'claimed' };
    } catch (err) {
      return { claimed: false };
    }
  }
}
