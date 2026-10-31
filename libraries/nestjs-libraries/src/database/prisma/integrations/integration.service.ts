import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { IntegrationRepository, isOwnedIntegrationPicture } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AnalyticsData,
  AuthTokenDetails,
  RecentPostStat,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Integration, Organization } from '@prisma/client';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import dayjs from 'dayjs';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  NotEnoughScopes,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import { difference, uniq } from 'lodash';
import utc from 'dayjs/plugin/utc';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { TemporalService } from 'nestjs-temporal-core';
import { IntegrationAuthorizationLifecycleService } from '@gitroom/nestjs-libraries/integrations/integration.authorization.lifecycle.service';

dayjs.extend(utc);

const RECENT_POSTS_LIMIT = 20;

// `unavailable`: the provider supports the list but it could not be loaded now
// (expired token on a read-only call, platform error)
export type RecentPostsResponse =
  | { supported: false; posts: [] }
  | { supported: true; unavailable?: true; posts: RecentPostStat[] };

@Injectable()
export class IntegrationService {
  private storage = UploadFactory.createStorage();
  constructor(
    private _integrationRepository: IntegrationRepository,
    private _autopostsRepository: AutopostRepository,
    private _integrationManager: IntegrationManager,
    private _notificationService: NotificationService,
    @Inject(forwardRef(() => RefreshIntegrationService))
    private _refreshIntegrationService: RefreshIntegrationService,
    private _temporalService: TemporalService,
    private _authorizationLifecycle: IntegrationAuthorizationLifecycleService
  ) {}

  async changeActiveCron(orgId: string) {
    const data = await this._autopostsRepository.getAutoposts(orgId);

    for (const item of data.filter((f) => f.active)) {
      try {
        await this._temporalService.terminateWorkflow(`autopost-${item.id}`);
      } catch (err) {}
    }

    return true;
  }

  getMentions(platform: string, q: string) {
    return this._integrationRepository.getMentions(platform, q);
  }

  insertMentions(
    platform: string,
    mentions: { name: string; username: string; image: string }[]
  ) {
    return this._integrationRepository.insertMentions(platform, mentions);
  }

  async setTimes(
    orgId: string,
    integrationId: string,
    times: IntegrationTimeDto
  ) {
    return this._integrationRepository.setTimes(orgId, integrationId, times);
  }

  updateProviderSettings(org: string, id: string, additionalSettings: string) {
    return this._integrationRepository.updateProviderSettings(
      org,
      id,
      additionalSettings
    );
  }

  checkPreviousConnections(org: string, id: string) {
    return this._integrationRepository.checkPreviousConnections(org, id);
  }

  async createOrUpdateIntegration(
    additionalSettings:
      | {
          title: string;
          description: string;
          type: 'checkbox' | 'text' | 'textarea';
          value: any;
          regex?: string;
        }[]
      | undefined,
    oneTimeToken: boolean,
    org: string,
    name: string,
    picture: string | undefined,
    type: 'article' | 'social',
    internalId: string,
    provider: string,
    token: string,
    refreshToken = '',
    expiresIn?: number,
    username?: string,
    isBetweenSteps = false,
    refresh?: string,
    timezone?: number,
    customInstanceDetails?: string
  ) {
    const policy = this._integrationManager.getSocialIntegration(provider)?.authorizationPolicy;
    let uploadedPicture = picture;
    if (picture && !policy?.useRemoteAvatar && !isOwnedIntegrationPicture(picture) && picture.indexOf('imagedelivery.net') === -1) {
      uploadedPicture = await this.storage.uploadSimple(picture).catch(() => undefined);
    }

    return this._integrationRepository.createOrUpdateIntegration(
      additionalSettings,
      oneTimeToken,
      org,
      name,
      uploadedPicture,
      type,
      internalId,
      provider,
      token,
      refreshToken,
      expiresIn,
      username,
      isBetweenSteps,
      refresh,
      timezone,
      customInstanceDetails,
      !!policy
    );
  }

  updateIntegrationGroup(org: string, id: string, group: string) {
    return this._integrationRepository.updateIntegrationGroup(org, id, group);
  }

  updateOnCustomerName(org: string, id: string, name: string) {
    return this._integrationRepository.updateOnCustomerName(org, id, name);
  }

  getIntegrationsList(org: string) {
    return this._integrationRepository.getIntegrationsList(org);
  }

  getChannelHealth(org: string, includeDeleted = false) {
    return this._integrationRepository.getChannelHealth(org, includeDeleted);
  }

  getIntegrationForOrder(id: string, order: string, user: string, org: string) {
    return this._integrationRepository.getIntegrationForOrder(
      id,
      order,
      user,
      org
    );
  }

  updateCustomName(org: string, id: string, name: string) {
    return this._integrationRepository.updateCustomName(org, id, name);
  }

  updateNameAndUrl(id: string, name: string, url: string) {
    return this._integrationRepository.updateNameAndUrl(id, name, url);
  }

  getIntegrationById(org: string, id: string) {
    return this._integrationRepository.getIntegrationById(org, id);
  }

  async getActiveIntegrationById(org: string, id: string) {
    const integration = await this.getIntegrationById(org, id);
    return integration && !integration.deletedAt && !integration.disabled && !integration.inBetweenSteps ? integration : null;
  }

  persistRefreshedAuthorization(integration: Integration, refresh: AuthTokenDetails) {
    return this._integrationRepository.updateAuthorizationIfActive(
      integration.organizationId, integration.id,
      { accessToken: refresh.accessToken, refreshToken: refresh.refreshToken, expiresIn: refresh.expiresIn },
      undefined, integration.token,
      !!this._integrationManager.getSocialIntegration(integration.providerIdentifier)?.oneTimeToken
    );
  }

  getIntegrationByInternalId(org: string, internalId: string) {
    return this._integrationRepository.getIntegrationByInternalId(
      org,
      internalId
    );
  }

  async refreshToken(provider: SocialProvider, refresh: string) {
    try {
      const { refreshToken, accessToken, expiresIn } =
        await provider.refreshToken(refresh);

      if (!refreshToken || !accessToken || !expiresIn) {
        return false;
      }

      return { refreshToken, accessToken, expiresIn };
    } catch (e) {
      return false;
    }
  }

  async disconnectChannel(orgId: string, integration: Integration, err = '') {
    const changed = await this._integrationRepository.disconnectChannel(orgId, integration.id, integration.token);
    if (!changed.count) return;
    const current = await this.getActiveIntegrationById(orgId, integration.id);
    if (!current || current.token !== integration.token) return;
    await this.informAboutRefreshError(orgId, integration, err);
  }

  // A reconnect that came back from a different provider (MIGRATE_PROVIDERS):
  // match the disconnected channel by profile and move it to the new provider
  // in place, so scheduled posts, settings and customers survive. Throws the
  // same error as a mismatched reconnect when the migration is not configured
  // or the user connected a different account.
  async migrateIntegration(
    org: string,
    oldInternalId: string,
    newProvider: string,
    auth: { id: string; username: string }
  ) {
    const existing = await this._integrationRepository.getIntegrationByInternalId(
      org,
      oldInternalId
    );

    if (
      !existing ||
      this._integrationManager.getMigrationTarget(
        existing.providerIdentifier
      ) !== newProvider
    ) {
      throw new NotEnoughScopes(
        'Please refresh the channel that needs to be refreshed'
      );
    }

    const oldProvider = this._integrationManager.getSocialIntegration(
      existing.providerIdentifier
    );

    if (!oldProvider.migrationMatch(auth, existing)) {
      throw new NotEnoughScopes(
        `Please connect the same account (@${existing.profile}) that needs to be refreshed`
      );
    }

    if (
      await this._integrationRepository.getIntegrationByInternalId(org, auth.id)
    ) {
      throw new NotEnoughScopes(
        'This account is already connected as another channel, please delete one of them first'
      );
    }

    return this._integrationRepository.migrateIntegration(
      org,
      existing.id,
      auth.id,
      newProvider,
      existing.rootInternalId === existing.internalId
        ? auth.id
        : existing.rootInternalId
    );
  }

  // A fresh connect of a migration target (MIGRATE_PROVIDERS) for an account
  // the org already has on the source provider: adopt that channel instead of
  // creating a confusing duplicate - the channel is migrated in place exactly
  // like a reconnect, and the follow-up upsert stores the fresh tokens. A no-op
  // when nothing matches, so a genuinely new account still creates a channel.
  async migrateIntegrationOnConnect(
    org: string,
    newProvider: string,
    auth: { id: string; username: string }
  ) {
    const sources = this._integrationManager.getMigrationSources(newProvider);
    if (
      !sources.length ||
      this._integrationManager.getSocialIntegration(newProvider).isBetweenSteps
    ) {
      return;
    }

    // the account already exists on the new provider: the normal upsert
    // updates it, nothing to adopt
    if (
      await this._integrationRepository.getIntegrationByInternalId(org, auth.id)
    ) {
      return;
    }

    const existing = (
      await this._integrationRepository.getIntegrationsList(org)
    ).find(
      (p) =>
        sources.includes(p.providerIdentifier) &&
        this._integrationManager
          .getSocialIntegration(p.providerIdentifier)
          .migrationMatch(auth, p)
    );

    if (!existing) {
      return;
    }

    return this._integrationRepository.migrateIntegration(
      org,
      existing.id,
      auth.id,
      newProvider,
      existing.rootInternalId === existing.internalId
        ? auth.id
        : existing.rootInternalId
    );
  }

  async informAboutRefreshError(
    orgId: string,
    integration: Integration,
    err = ''
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      `Could not refresh your ${integration.providerIdentifier} channel`,
      `Could not refresh your ${integration.providerIdentifier} channel ${err}. Please go back to the system and connect it again ${process.env.FRONTEND_URL}/launches`,
      true,
      false,
      'info',
      { integrationId: integration.id }
    );
  }

  async refreshNeeded(org: string, id: string, expectedToken?: string) {
    return this._integrationRepository.refreshNeeded(org, id, expectedToken);
  }

  async setBetweenRefreshSteps(id: string, expectedToken?: string) {
    return this._integrationRepository.setBetweenRefreshSteps(id, expectedToken);
  }

  async refreshTokens() {
    const integrations = await this._integrationRepository.needsToBeRefreshed();
    for (const integration of integrations) {
      await this._refreshIntegrationService.refresh(integration);
    }
  }

  async disableChannel(org: string, id: string) {
    return this._integrationRepository.disableChannel(org, id);
  }

  async enableChannel(org: string, totalChannels: number, id: string) {
    const integrations = (
      await this._integrationRepository.getIntegrationsList(org)
    ).filter((f) => !f.disabled);
    if (
      !!process.env.STRIPE_PUBLISHABLE_KEY &&
      integrations.length >= totalChannels
    ) {
      throw new Error('You have reached the maximum number of channels');
    }

    return this._integrationRepository.enableChannel(org, id);
  }

  async getPostsForChannel(org: string, id: string) {
    return this._integrationRepository.getPostsForChannel(org, id);
  }

  async deleteChannel(org: string, id: string) {
    return this._authorizationLifecycle.requestDeletion(org, id);
  }

  async disableIntegrations(org: string, totalChannels: number) {
    return this._integrationRepository.disableIntegrations(org, totalChannels);
  }

  async enableAllIntegrations(org: string) {
    return this._integrationRepository.enableAllIntegrations(org);
  }

  async checkForDeletedOnceAndUpdate(org: string, page: string) {
    return this._integrationRepository.checkForDeletedOnceAndUpdate(org, page);
  }

  async saveProviderPage(org: string, id: string, data: any) {
    const getIntegration = await this._integrationRepository.getIntegrationById(
      org,
      id
    );
    if (!getIntegration) {
      throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
    }
    if (!getIntegration.inBetweenSteps) {
      throw new HttpException('Invalid request', HttpStatus.BAD_REQUEST);
    }

    const provider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    if (!provider.fetchPageInformation) {
      throw new HttpException(
        'Provider does not support page selection',
        HttpStatus.BAD_REQUEST
      );
    }

    const getIntegrationInformation = await provider.fetchPageInformation(
      getIntegration.token,
      data
    );

    await this.checkForDeletedOnceAndUpdate(
      org,
      String(getIntegrationInformation.id)
    );
    await this._integrationRepository.updateIntegration(id, {
      picture: getIntegrationInformation.picture,
      internalId: String(getIntegrationInformation.id),
      organizationId: org,
      name: getIntegrationInformation.name,
      inBetweenSteps: false,
      token: getIntegrationInformation.access_token,
      profile: getIntegrationInformation.username,
    }, !!provider.authorizationPolicy, !!provider.authorizationPolicy?.useRemoteAvatar);

    return { success: true };
  }

  async checkAnalytics(
    org: Organization,
    integration: string,
    date: string,
    forceRefresh = false,
    // read-only callers (the analytics overview) never refresh or disconnect
    allowRefresh = true
  ): Promise<AnalyticsData[]> {
    // Days to load, missing or invalid on some public API calls (same default as the app)
    const days = Number(date) > 0 ? Number(date) : 7;
    const getIntegration = await this.getIntegrationById(org.id, integration);

    if (!getIntegration || getIntegration.deletedAt || getIntegration.disabled || getIntegration.inBetweenSteps) {
      throw new Error('Invalid integration');
    }

    if (getIntegration.type !== 'social') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      if (!allowRefresh) {
        return [];
      }
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this.disconnectChannel(org.id, getIntegration);
        return [];
      }
    }

    const bypassCache = integrationProvider.authorizationPolicy?.bypassAnalyticsCache;
    const getIntegrationData = bypassCache ? undefined : await ioRedis.get(`integration:${org.id}:${integration}:${days}`);
    if (getIntegrationData) {
      return JSON.parse(getIntegrationData);
    }

    if (integrationProvider.analytics) {
      try {
        const loadAnalytics = await integrationProvider.analytics(
          getIntegration.internalId,
          getIntegration.token,
          days
        );
        if (bypassCache) {
          const current = await this.getActiveIntegrationById(org.id, integration);
          if (!current || current.token !== getIntegration.token) return [];
        } else await ioRedis.set(
          `integration:${org.id}:${integration}:${days}`,
          JSON.stringify(loadAnalytics),
          'EX',
          !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
            ? 1
            : 3600
        );
        return loadAnalytics;
      } catch (e) {
        if (e instanceof RefreshToken && allowRefresh) {
          return this.checkAnalytics(org, integration, date, true);
        }
      }
    }

    return [];
  }

  // The "Recent posts" list of the channel analytics view: the same lookup,
  // token handling and hour-long cache as checkAnalytics. The cache key falls
  // under the `integration:{org}:{id}:*` pattern purgeAnalytics clears.
  async recentPosts(
    org: Organization,
    integration: string,
    // read-only callers never refresh or disconnect
    allowRefresh = true,
    forceRefresh = false
  ): Promise<RecentPostsResponse> {
    const getIntegration = await this.getIntegrationById(org.id, integration);

    if (!getIntegration || getIntegration.deletedAt || getIntegration.disabled || getIntegration.inBetweenSteps) {
      throw new Error('Invalid integration');
    }

    const integrationProvider =
      getIntegration.type === 'social'
        ? this._integrationManager.getSocialIntegration(
            getIntegration.providerIdentifier
          )
        : undefined;

    if (!integrationProvider?.recentPosts) {
      return { supported: false, posts: [] };
    }

    const unavailable = {
      supported: true as const,
      unavailable: true as const,
      posts: [] as RecentPostStat[],
    };

    if (
      dayjs(getIntegration.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      if (!allowRefresh) {
        return unavailable;
      }
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return unavailable;
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this.disconnectChannel(org.id, getIntegration);
        return unavailable;
      }
    }

    const cacheKey = `integration:${org.id}:${integration}:recent-posts`;
    const bypassCache = integrationProvider.authorizationPolicy?.bypassAnalyticsCache;
    const cached = bypassCache ? undefined : await ioRedis.get(cacheKey);
    if (cached) {
      return { supported: true, posts: JSON.parse(cached) };
    }

    try {
      const posts = await integrationProvider.recentPosts(
        getIntegration.internalId,
        getIntegration.token,
        RECENT_POSTS_LIMIT
      );
      if (bypassCache) {
        const current = await this.getActiveIntegrationById(org.id, integration);
        if (!current || current.token !== getIntegration.token) return unavailable;
      } else await ioRedis.set(
        cacheKey,
        JSON.stringify(posts),
        'EX',
        !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
          ? 1
          : 3600
      );
      return { supported: true, posts };
    } catch (e) {
      if (e instanceof RefreshToken && allowRefresh && !forceRefresh) {
        return this.recentPosts(org, integration, true, true);
      }
      return unavailable;
    }
  }

  customers(orgId: string) {
    return this._integrationRepository.customers(orgId);
  }

  async updateCustomerName(orgId: string, id: string, name: string) {
    const exists = await this._integrationRepository.getCustomerByName(
      orgId,
      name
    );
    if (exists && exists.id !== id) {
      throw new HttpException(
        'A group with this name already exists',
        HttpStatus.BAD_REQUEST
      );
    }
    return this._integrationRepository.updateCustomerName(orgId, id, name);
  }

  getPlugsByIntegrationId(org: string, integrationId: string) {
    return this._integrationRepository.getPlugsByIntegrationId(
      org,
      integrationId
    );
  }

  async processInternalPlug(
    data: {
      post: string;
      originalIntegration: string;
      integration: string;
      plugName: string;
      orgId: string;
      delay: number;
      information: any;
    },
    forceRefresh = false
  ): Promise<any> {
    const originalIntegration =
      await this._integrationRepository.getIntegrationById(
        data.orgId,
        data.originalIntegration
      );

    const getIntegration = await this._integrationRepository.getIntegrationById(
      data.orgId,
      data.integration
    );

    if (!getIntegration || !originalIntegration) {
      return;
    }

    const getAllInternalPlugs = this._integrationManager
      .getInternalPlugs(getIntegration.providerIdentifier)
      .internalPlugs.find((p: any) => p.identifier === data.plugName);

    if (!getAllInternalPlugs) {
      return;
    }

    const getSocialIntegration = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    // @ts-ignore
    await getSocialIntegration?.[getAllInternalPlugs.methodName]?.(
      getIntegration,
      originalIntegration,
      data.post,
      data.information
    );

    return;
  }

  async processPlugs(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    const getPlugById = await this._integrationRepository.getPlug(data.plugId);
    if (!getPlugById) {
      return true;
    }

    const integration = this._integrationManager.getSocialIntegration(
      getPlugById.integration.providerIdentifier
    );

    // @ts-ignore
    const process = await integration[getPlugById.plugFunction](
      getPlugById.integration,
      data.postId,
      JSON.parse(getPlugById.data).reduce((all: any, current: any) => {
        all[current.name] = current.value;
        return all;
      }, {})
    );

    if (process) {
      return true;
    }

    if (data.totalRuns === data.currentRun) {
      return true;
    }

    return false;
  }

  async createOrUpdatePlug(
    orgId: string,
    integrationId: string,
    body: PlugDto
  ) {
    const { activated } = await this._integrationRepository.createOrUpdatePlug(
      orgId,
      integrationId,
      body
    );

    return {
      activated,
    };
  }

  async changePlugActivation(orgId: string, plugId: string, status: boolean) {
    const { id, integrationId, plugFunction } =
      await this._integrationRepository.changePlugActivation(
        orgId,
        plugId,
        status
      );

    return { id };
  }

  async getPlugs(orgId: string, integrationId: string) {
    return this._integrationRepository.getPlugs(orgId, integrationId);
  }

  async loadExisingData(
    methodName: string,
    integrationId: string,
    id: string[]
  ) {
    const exisingData = await this._integrationRepository.loadExisingData(
      methodName,
      integrationId,
      id
    );
    const loadOnlyIds = exisingData.map((p) => p.value);
    return difference(id, loadOnlyIds);
  }

  async findFreeDateTime(
    orgId: string,
    integrationsId?: string
  ): Promise<number[]> {
    const findTimes = await this._integrationRepository.getPostingTimes(
      orgId,
      integrationsId
    );
    return uniq(
      findTimes.reduce((all: any, current: any) => {
        return [
          ...all,
          ...JSON.parse(current.postingTimes).map(
            (p: { time: number }) => p.time
          ),
        ];
      }, [] as number[])
    );
  }
}
