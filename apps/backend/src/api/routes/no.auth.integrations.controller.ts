import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { ConnectIntegrationDto } from '@gitroom/nestjs-libraries/dtos/integrations/connect.integration.dto';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { ApiTags } from '@nestjs/swagger';
import { NotEnoughScopesFilter } from '@gitroom/nestjs-libraries/integrations/integration.missing.scopes';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AuthTokenDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { writeCustomInstanceDetails } from '@gitroom/nestjs-libraries/database/prisma/integrations/custom.instance.details';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { getSessionUser } from '@gitroom/backend/services/auth/auth.middleware';
import { isCrossSiteCookieRequest } from '@gitroom/backend/services/auth/csrf';
import { Organization } from '@prisma/client';
import {
  ConnectBinding,
  CONNECT_OTHER_BROWSER_MESSAGE,
  confirmConnectBinding,
  connectLinkCreator,
  connectNonceCookie,
  connectNonceCookieOptions,
  connectNonceMatches,
  deleteConnectBinding,
  deleteConnectState,
  isConnectLink,
  notifiesAdmins,
  readConnectBinding,
} from '@gitroom/nestjs-libraries/integrations/connect.binding';

@ApiTags('Integrations')
@Controller('/integrations')
export class NoAuthIntegrationsController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _organizationService: OrganizationService,
    private _permissionsService: PermissionsService,
    private _usersService: UsersService
  ) {}

  // The id of the member signed in on this request, by the auth header or by
  // the auth cookie of a request sent from the app itself
  private async signedInUserId(req: Request) {
    const auth = req.headers?.auth || req.cookies?.auth;
    if (!auth || typeof auth !== 'string' || isCrossSiteCookieRequest(req)) {
      return undefined;
    }
    return (await getSessionUser(this._usersService, auth))?.id;
  }

  private async isActiveMember(orgId: string, userId: string) {
    return !!(await this._organizationService.getActiveTeam(orgId))?.users.some(
      (member) => member.user.id === userId
    );
  }

  // Whoever finishes a connect is whoever started it (see connect.binding).
  // A connect started in the app needs that browser's nonce cookie and that
  // member still in the workspace. The same member signed in stands in for
  // the cookie only under NOT_SECURED, where the app and the API can sit on
  // different sites and a cookie may not travel. A shared link is confirmed
  // by the person who opens it instead (the caller asks). Runs before
  // anything of the state is spent, a refused callback changes nothing.
  private async checkConnectBinding(
    req: Request,
    state: string,
    binding: ConnectBinding,
    orgId: string
  ) {
    if (binding.orgId !== orgId) {
      throw new HttpException(CONNECT_OTHER_BROWSER_MESSAGE, 403);
    }

    if (isConnectLink(binding)) {
      return;
    }

    const sameBrowser = connectNonceMatches(
      binding,
      req.cookies?.[connectNonceCookie(state)]
    );
    if (
      !binding.userId ||
      !(
        sameBrowser ||
        (!!process.env.NOT_SECURED &&
          (await this.signedInUserId(req)) === binding.userId)
      ) ||
      !(await this.isActiveMember(orgId, binding.userId))
    ) {
      throw new HttpException(CONNECT_OTHER_BROWSER_MESSAGE, 403);
    }
  }

  // This route runs without a session, so the guard never checked the plan's
  // channel limit. A channel the workspace already has (a reconnect) never
  // counts as a new one
  private async checkChannelLimit(org: Organization, internalId?: string) {
    if (
      internalId &&
      (await this._integrationService.getIntegrationByInternalId(
        org.id,
        internalId
      ))
    ) {
      return;
    }
    if (await this._permissionsService.canAddChannel(org.id, org.createdAt)) {
      return;
    }
    const message = await this._permissionsService
      .channelLimitMessage(org.id)
      .catch((): undefined => undefined);
    throw new SubscriptionException({
      section: Sections.CHANNEL,
      action: AuthorizationActions.Create,
      ...(message ? { message } : {}),
    });
  }

  // What the person opening a shared link is asked to confirm: the
  // workspace, the network and who created the link, plus a warning when they
  // are signed in to PostDelegate but not a member of that workspace
  private async linkConfirmation(
    req: Request,
    org: Organization,
    binding: ConnectBinding,
    providerName: string
  ) {
    const creator = binding.userId
      ? await this._usersService.getUserById(binding.userId).catch(() => null)
      : null;
    const viewer = await this.signedInUserId(req);
    return {
      needsConfirmation: true,
      workspaceName: org.name,
      providerName,
      createdBy: connectLinkCreator(creator),
      signedInOutsideWorkspace:
        !!viewer && !(await this.isActiveMember(org.id, viewer)),
    };
  }

  // The state is spent: its binding goes, and the nonce cookie with it.
  // Always after organization:{state} is gone, a state without a binding is
  // read as one started before bindings existed
  private async spendConnectBinding(
    res: Response,
    state: string,
    binding?: ConnectBinding
  ) {
    if (!binding) {
      return;
    }
    await deleteConnectBinding(state);
    if (!isConnectLink(binding)) {
      res.cookie(connectNonceCookie(state), '', connectNonceCookieOptions(-1));
    }
  }

  @Get('/')
  getIntegrations() {
    return this._integrationManager.getAllIntegrations();
  }

  @Post('/social-connect/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  @UseFilters(new NotEnoughScopesFilter())
  async connectSocialMedia(
    @Param('integration') integration: string,
    @Body() body: ConnectIntegrationDto,
    @Req() req: Request,
    // not "res": the token exchange below names its resolve function that
    @Res({ passthrough: true }) response: Response
  ) {
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new Error('Integration not allowed');
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    const getCodeVerifier = integrationProvider.customFields
      ? 'none'
      : await ioRedis.get(`login:${body.state}`);
    if (!getCodeVerifier) {
      // The state expires after an hour and is deleted once used (page reload)
      throw new HttpException(
        'This connection link expired or was already used, please connect the channel again',
        400
      );
    }

    const organization = await ioRedis.get(`organization:${body.state}`);
    if (!organization) {
      // spent or expired, the same answer the code verifier check gives
      throw new HttpException(
        'This connection link expired or was already used, please connect the channel again',
        400
      );
    }

    const org = await this._organizationService.getOrgById(organization);

    // No binding exists only for a state created before this release (every
    // producer writes it first, Redis never evicts); it keeps the old
    // behaviour until it expires, an hour at most. Remove this branch once
    // the release is an hour old
    const binding = await readConnectBinding(body.state);
    const sharedLink = !!binding && isConnectLink(binding);
    if (binding) {
      await this.checkConnectBinding(req, body.state, binding, org.id);
    }

    // A shared link says which workspace it adds the account to before the
    // code is exchanged; nothing of the state is spent until the person
    // confirms and the page posts again with confirmed: true. What can be
    // refused without the account (a network not available to the
    // workspace, a full plan) is refused before asking
    if (binding && sharedLink && body.confirmed !== true) {
      const pendingRefresh =
        (await ioRedis.get(`refresh:${body.state}`)) || undefined;
      await this._integrationService.checkProviderAvailable(
        org.id,
        integration,
        pendingRefresh
      );
      await this.checkChannelLimit(org, pendingRefresh);
      return this.linkConfirmation(
        req,
        org,
        binding,
        integrationProvider.name
      );
    }

    if (!integrationProvider.customFields) {
      await ioRedis.del(`login:${body.state}`);
    }

    const details = integrationProvider.externalUrl
      ? await ioRedis.get(`external:${body.state}`)
      : undefined;

    if (details) {
      await ioRedis.del(`external:${body.state}`);
    }

    // deleted with the login state once the channel is saved, so a retried
    // custom-field reconnect still knows which channel it refreshes
    let refresh = await ioRedis.get(`refresh:${body.state}`);

    const onboarding = await ioRedis.get(`onboarding:${body.state}`);
    if (onboarding) {
      await ioRedis.del(`onboarding:${body.state}`);
    }

    // the state could come from another provider's connect link, so the
    // provider this callback saves is checked again here
    await this._integrationService.checkProviderAvailable(
      org.id,
      integration,
      refresh || undefined
    );

    const {
      error,
      accessToken,
      expiresIn,
      refreshToken,
      id,
      name,
      picture,
      username,
      additionalSettings,
      // eslint-disable-next-line no-async-promise-executor
    } = await new Promise<AuthTokenDetails>(async (res) => {
      try {
        const auth = await integrationProvider.authenticate(
          {
            code: body.code,
            codeVerifier: getCodeVerifier,
            refresh: body.refresh,
          },
          details ? JSON.parse(details) : undefined
        );

        if (typeof auth === 'string') {
          return res({
            error: auth,
            accessToken: '',
            id: '',
            name: '',
            picture: '',
            username: '',
            additionalSettings: [],
          });
        }

        if (refresh && integrationProvider.reConnect) {
          console.log('reconnect');
          try {
            const newAuth = await integrationProvider.reConnect(
              auth.id,
              refresh,
              auth.accessToken
            );
            // keep the fresh refresh token and expiration from the new
            // authentication, otherwise the stored refresh token is wiped and
            // the channel breaks again as soon as the access token expires
            return res({
              ...newAuth,
              refreshToken: auth.refreshToken,
              expiresIn: auth.expiresIn,
            });
          } catch (err: any) {
            return res({
              error: err.message,
              accessToken: '',
              id: '',
              name: '',
              picture: '',
              username: '',
              additionalSettings: [],
            });
          }
        }

        return res(auth);
      } catch (err) {
        if (err instanceof NotEnoughScopes) {
          return res({
            error: err.message,
            accessToken: '',
            id: '',
            name: '',
            picture: '',
            username: '',
            additionalSettings: [],
          });
        }

        console.log(`Authentication failed for ${integration}:`, err);
        return res({
          error: 'Authentication failed',
          accessToken: '',
          id: '',
          name: '',
          picture: '',
          username: '',
          additionalSettings: [],
        });
      }
    });

    if (error) {
      throw new NotEnoughScopes(error);
    }

    if (!id) {
      throw new NotEnoughScopes('Invalid API key');
    }

    // Custom-field providers build the account id from what the person typed
    // (the site URL for WordPress and Listmonk), so "Update credentials" with
    // the same site written differently comes back with another id. Nothing
    // migrates into this provider, so it can't be a migration: save it as a
    // fresh connect like before, still behind the hidden-provider check.
    if (
      refresh &&
      integrationProvider.customFields &&
      String(id) !== String(refresh) &&
      !this._integrationManager.getMigrationSources(integration).length
    ) {
      await this._integrationService.checkProviderAvailable(org.id, integration);
      refresh = null;
    }

    let validName = name;
    if (!validName) {
      if (username) {
        validName = username.split('.')[0] ?? username;
      } else {
        validName = `Channel_${String(id).slice(0, 8)}`;
      }
    }

    if (
      process.env.STRIPE_PUBLISHABLE_KEY &&
      org.isTrailing &&
      (await this._integrationService.checkPreviousConnections(
        org.id,
        String(id)
      ))
    ) {
      throw new HttpException('', 412);
    }

    await this._integrationService.checkCappedProviderSwitch(
      org.id,
      String(id),
      integration
    );

    await this.checkChannelLimit(org, refresh || String(id));

    if (refresh && String(id) !== String(refresh)) {
      // A reconnect that returns a different id is either the wrong account or
      // a channel migrating to another provider (MIGRATE_PROVIDERS) - the two
      // apps return different app-scoped ids, so the channel is matched by
      // profile and moved in place. Throws for anything else. Runs after every
      // check that can reject the connect, so a rejection can never leave a
      // half-migrated channel behind.
      await this._integrationService.migrateIntegration(
        org.id,
        refresh,
        integration,
        { id: String(id), username }
      );
    } else if (!refresh) {
      // A fresh connect of a migration target for an account the org already
      // has on the source provider adopts that channel instead of creating a
      // duplicate. No-op for everything else.
      await this._integrationService.migrateIntegrationOnConnect(
        org.id,
        integration,
        { id: String(id), username }
      );
    }

    const createUpdate =
      await this._integrationService.createOrUpdateIntegration(
        additionalSettings,
        !!integrationProvider.oneTimeToken,
        org.id,
        validName.trim(),
        picture,
        'social',
        String(id),
        integration,
        accessToken,
        refreshToken,
        expiresIn,
        username,
        refresh ? false : integrationProvider.isBetweenSteps,
        // the verified channel from the state, never the client's body
        refresh || undefined,
        +body.timezone,
        details
          ? writeCustomInstanceDetails(details)
          : integrationProvider.customFields
          ? writeCustomInstanceDetails(
              Buffer.from(body.code, 'base64').toString()
            )
          : integrationProvider.isChromeExtension
          ? writeCustomInstanceDetails(
              Buffer.from(body.code, 'base64').toString()
            )
          : undefined
      );

    this._refreshIntegrationService
      .startRefreshWorkflow(org.id, createUpdate.id, integrationProvider)
      .catch((err) => {
        console.log(err);
      });

    // the admins hear about every account an invite or API link added, so
    // one they did not expect is easy to spot and remove
    if (binding && notifiesAdmins(binding)) {
      this._integrationService
        .informAboutLinkConnect(
          org.id,
          org.name,
          username ? `@${username}` : validName.trim(),
          integrationProvider.name
        )
        .catch((err) => {
          console.log(err);
        });
    }

    // Fetch pages if this is a two-step provider and not a refresh
    let pages: any[] = [];
    if (integrationProvider.isBetweenSteps && !refresh) {
      try {
        // Check which method the provider uses (pages or companies)
        const fetchMethod =
          'pages' in integrationProvider
            ? 'pages'
            : 'companies' in integrationProvider
            ? 'companies'
            : null;

        if (fetchMethod) {
          // @ts-ignore - dynamic method call
          pages = await integrationProvider[fetchMethod](accessToken);
        }
      } catch (err) {
        console.log('Failed to fetch pages:', err);
      }
    }

    // The org behind the state is spent once the channel is saved. A
    // provider that still has to pick a page keeps it for that one last step
    // (saveProviderPage deletes it), and a failed attempt above leaves it for
    // the retry of providers that take credentials from the person
    if (!(integrationProvider.isBetweenSteps && !refresh)) {
      await ioRedis.del(`organization:${body.state}`);
      await this.spendConnectBinding(response, body.state, binding);
    } else if (binding && sharedLink) {
      // the page picking step that follows is part of this confirmed connect
      await confirmConnectBinding(body.state, binding);
    }

    await ioRedis.del(`login:${body.state}`);
    await ioRedis.del(`refresh:${body.state}`);

    const webhookUrl = await ioRedis.get(`webhookUrl:${body.state}`);
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            params: AuthService.signTypedJWT('connect-webhook', {
              // the readable key: the partner presents it back to
              // getOrgByApiKey, so the stored form would not work
              apiKey: this._organizationService.readApiKey(org),
            }),
          }),
          // @ts-ignore — undici option, not in lib.dom fetch types
          dispatcher: getSsrfSafeDispatcher(),
        });
      } catch (err) {}

      await ioRedis.del(`webhookUrl:${body.state}`);
    }

    const returnURL = await ioRedis.get(`redirect:${body.state}`);
    if (returnURL) {
      await ioRedis.del(`redirect:${body.state}`);
    }

    const extensionToken = integrationProvider.isChromeExtension
      ? AuthService.signTypedJWT('extension', {
          integrationId: createUpdate.id,
          organizationId: org.id,
          internalId: String(id),
          provider: integration,
        })
      : undefined;

    // Never leak stored credentials (signed/encrypted secrets) back to the
    // caller. These columns hold the integration access token, refresh token
    // and encrypted custom instance details and must stay server-side.
    const {
      token: _token,
      refreshToken: _refreshToken,
      customInstanceDetails: _customInstanceDetails,
      ...safeIntegration
    } = createUpdate as any;

    return {
      ...safeIntegration,
      onboarding: onboarding === 'true',
      pages,
      ...(returnURL ? { returnURL } : {}),
      ...(extensionToken ? { extensionToken } : {}),
    };
  }

  // "Cancel" on the confirmation of a shared link: the state is dropped so
  // the code the platform sent can never be completed later. Only a link not
  // confirmed yet, a connect started in the app is never cancelled by state
  @Post('/social-connect/:integration/cancel')
  async cancelLinkConnect(@Body('state') state: string) {
    if (!state || typeof state !== 'string') {
      throw new HttpException('Invalid state', 400);
    }
    const binding = await readConnectBinding(state);
    if (!binding || !isConnectLink(binding) || binding.confirmed) {
      return { cancelled: false };
    }
    await deleteConnectState(state);
    return { cancelled: true };
  }

  @Post('/public/provider/:id/connect')
  async saveProviderPage(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!body.state || typeof body.state !== 'string') {
      throw new Error('Invalid state');
    }

    const organization = await ioRedis.get(`organization:${body.state}`);
    if (!organization) {
      // spent or expired, the same answer the code verifier check gives
      throw new HttpException(
        'This connection link expired or was already used, please connect the channel again',
        400
      );
    }

    const org = await this._organizationService.getOrgByIdWithSubscription(
      organization
    );
    if (!org) {
      throw new HttpException(
        'This connection link expired or was already used, please connect the channel again',
        400
      );
    }

    // the page is picked by whoever finished the connect: the same browser,
    // or the person who confirmed the shared link
    const binding = await readConnectBinding(body.state);
    if (binding) {
      await this.checkConnectBinding(req, body.state, binding, org.id);
      if (isConnectLink(binding) && !binding.confirmed) {
        throw new HttpException(
          'This connection link expired or was already used, please connect the channel again',
          400
        );
      }
    }

    const saved = await this._integrationService.saveProviderPage(
      org.id,
      id,
      body,
      org.subscription?.totalChannels || pricing.FREE.channel!
    );
    await ioRedis.del(`organization:${body.state}`);
    await this.spendConnectBinding(res, body.state, binding);
    return saved;
  }

  @Post('/extension-refresh')
  async extensionRefreshCookies(
    @Body() body: { jwt: string; cookies: string }
  ) {
    let payload: any;
    try {
      payload = AuthService.verifyTypedJWT(body.jwt, 'extension');
    } catch {
      throw new HttpException('Invalid token', 401);
    }

    const { integrationId, organizationId, internalId, provider } = payload;
    if (
      !integrationId ||
      typeof integrationId !== 'string' ||
      !organizationId ||
      typeof organizationId !== 'string' ||
      !internalId ||
      typeof internalId !== 'string' ||
      !provider ||
      typeof provider !== 'string'
    ) {
      throw new HttpException('Invalid token payload', 400);
    }

    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    if (
      !integration ||
      integration.internalId !== internalId ||
      integration.providerIdentifier !== provider
    ) {
      throw new HttpException('Integration not found', 404);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(provider);
    if (!integrationProvider?.isChromeExtension) {
      throw new HttpException('Not a Chrome extension integration', 400);
    }

    const authResult = await integrationProvider.authenticate({
      code: body.cookies,
      codeVerifier: '',
    });

    if (typeof authResult === 'string') {
      throw new HttpException(authResult, 400);
    }

    if (String(authResult.id) !== String(integration.internalId)) {
      await this._integrationService.refreshNeeded(
        organizationId,
        integrationId
      );
      return { success: false, reason: 'account_mismatch' };
    }

    await this._integrationService.createOrUpdateIntegration(
      undefined,
      false,
      organizationId,
      integration.name,
      undefined,
      'social',
      integration.internalId,
      integration.providerIdentifier,
      authResult.accessToken,
      '',
      authResult.expiresIn,
      undefined,
      false,
      undefined,
      undefined,
      // stored encrypted like connectSocialMedia does, never signed: the
      // cookies JSON comes from the request
      writeCustomInstanceDetails(
        Buffer.from(body.cookies, 'base64').toString()
      )
    );

    return { success: true };
  }
}
