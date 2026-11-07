import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { saveConnectBinding } from '@gitroom/nestjs-libraries/integrations/connect.binding';

@ApiTags('Enterprise')
@Controller('/enterprise')
export class EnterpriseController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _organizationService: OrganizationService,
    private _integrationService: IntegrationService,
    private _postsService: PostsService
  ) {}

  private verifyEnterpriseToken<T extends object>(params: string): T {
    // signed by the partner platform with typ "enterprise-user", a session,
    // reset, activation or invite token is rejected by its type
    return AuthService.verifyTypedJWT<T>(params, 'enterprise-user');
  }

  @Post('/create-user')
  async createUser(@Body('params') params: string) {
    try {
      const { id, name, saasName, email } = this.verifyEnterpriseToken<{
        id: string;
        name: string;
        email: string;
        saasName: string;
      }>(params);

      if (!id || !saasName) {
        return { success: false };
      }

      try {
        return await this._organizationService.createMaxUser(
          id,
          name,
          saasName,
          email
        );
      } catch (err) {
        return { create: false };
      }
    } catch (err) {
      return { success: false };
    }
  }

  @Post('/url')
  async redirectParams(@Body('params') params: string) {
    try {
      const load = this.verifyEnterpriseToken<{
        redirectUrl: string;
        apiKey: string;
        refreshId?: string;
        provider: string;
        webhookUrl: string;
      }>(params);

      if (
        !load ||
        !load.redirectUrl ||
        !load.apiKey ||
        typeof load.apiKey !== 'string' ||
        !load.provider
      ) {
        return;
      }

      const org = await this._organizationService.getOrgByApiKey(load.apiKey);

      if (!org) {
        throw new Error('Organization not found');
      }

      if (
        !this._integrationManager
          .getAllowedSocialsIntegrations()
          .includes(load.provider)
      ) {
        throw new Error('Integration not allowed');
      }

      await this._integrationService.checkProviderAvailable(
        org.id,
        load.provider,
        load.refreshId
      );

      const integrationProvider = this._integrationManager.getSocialIntegration(
        load.provider
      );

      const { codeVerifier, state, url } =
        await integrationProvider.generateAuthUrl();

      // opened in the partner's customer's browser, never ours: the person
      // confirms the workspace, once (see connect.binding)
      const { ttl } = await saveConnectBinding(state, {
        type: 'enterprise',
        orgId: org.id,
      });

      if (load.refreshId) {
        await ioRedis.set(`refresh:${state}`, load.refreshId, 'EX', ttl);
      }

      await ioRedis.set(`webhookUrl:${state}`, load.webhookUrl, 'EX', ttl);
      await ioRedis.set(`redirect:${state}`, load.redirectUrl, 'EX', ttl);
      await ioRedis.set(`organization:${state}`, org.id, 'EX', ttl);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', ttl);

      return url;
    } catch (err) {}
  }

  @Post('/delete-channel')
  async deleteChannel(@Body('params') params: string) {
    try {
      const load = this.verifyEnterpriseToken<{
        apiKey: string;
        id: string;
      }>(params);

      if (
        !load ||
        !load.apiKey ||
        !load.id ||
        typeof load.apiKey !== 'string' ||
        typeof load.id !== 'string'
      ) {
        return { success: false };
      }

      const org = await this._organizationService.getOrgByApiKey(load.apiKey);

      if (!org) {
        return { success: false };
      }

      await this._integrationService.deleteChannel(org.id, load.id);
      const isTherePosts = await this._integrationService.getPostsForChannel(
        org.id,
        load.id
      );
      if (isTherePosts.length) {
        for (const post of isTherePosts) {
          this._postsService.deletePost(org.id, post.group).catch(() => {});
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false };
    }
  }
}
