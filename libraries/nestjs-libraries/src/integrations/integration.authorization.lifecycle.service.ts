import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { IntegrationRepository, isOwnedIntegrationPicture } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { ProviderAuthorizationCredentials, SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { TemporalService } from 'nestjs-temporal-core';
import { isChannelDisconnected } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';

type CleanupRow = NonNullable<Awaited<ReturnType<IntegrationRepository['getIntegrationForCleanup']>>>;

@Injectable()
export class IntegrationAuthorizationLifecycleService {
  private storage = UploadFactory.createStorage();

  constructor(
    private _repository: IntegrationRepository,
    private _manager: IntegrationManager,
    private _temporalService: TemporalService
  ) {}

  private enabled() {
    return process.env.INTEGRATION_AUTHORIZATION_LIFECYCLE_ENABLED === 'true';
  }

  private requireEnabled() {
    if (!this.enabled()) {
      throw new HttpException(
        'Provider data removal is not enabled yet. Please contact support before disconnecting this account.',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private credentials(row: {
    token: string;
    refreshToken?: string | null;
    internalId: string;
    rootInternalId?: string | null;
  }): ProviderAuthorizationCredentials {
    return {
      accessToken: row.token,
      refreshToken: row.refreshToken,
      internalId: row.internalId,
      rootInternalId: row.rootInternalId,
    };
  }

  // True while another live channel of the provider's authorizationGrantGroup
  // (any organization, a pending location or page choice included) still uses
  // the account's grant; removedIds go away with this one. managed: the
  // managed lifecycle removes its own verified siblings with the grant, so
  // only providers outside it keep the grant.
  private async grantStillInUse(provider: SocialProvider, row: CleanupRow, removedIds: string[], managed = false) {
    const group = provider.authorizationGrantGroup;
    if (!group) return false;
    // the account is unknown: outside the managed lifecycle, never risk
    // ending another channel's access
    if (!row.rootInternalId) return !managed;
    const providers = this._manager.getAuthorizationGrantGroup(group)
      .filter((p) => !managed || !p.authorizationPolicy)
      .map((p) => p.identifier);
    return !!providers.length &&
      (await this._repository.countLiveChannelsOnGrant(row.rootInternalId, providers, removedIds)) > 0;
  }

  // Providers outside the managed lifecycle that can revoke their grant: best
  // effort, never blocks the removal and logs a failure without credentials.
  private async revokeBestEffort(provider: SocialProvider, row: CleanupRow, removedIds: string[]) {
    try {
      if (await this.grantStillInUse(provider, row, removedIds)) return;
      const result = await provider.revokeAuthorization!(this.credentials(row));
      if (result.status !== 'revoked') console.error(`Integration ${row.id}: ${row.providerIdentifier} did not confirm the revocation`);
    } catch {
      console.error(`Integration ${row.id}: ${row.providerIdentifier} revocation failed`);
    }
  }

  async requestDeletion(organizationId: string, integrationId: string, expectedToken?: string): Promise<{ id: string }> {
    const row = await this._repository.getIntegrationForCleanup(organizationId, integrationId);
    if (!row) throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
    const provider = this._manager.getSocialIntegration(row.providerIdentifier);
    if (!provider?.authorizationPolicy) {
      if (!provider?.revokeAuthorization) {
        return this._repository.deleteChannel(organizationId, integrationId);
      }
      // A provider outside the managed lifecycle that can still revoke its
      // grant: the channel and its stored tokens are deleted first, then the
      // grant is revoked with the credentials already in memory - best
      // effort, it never blocks or delays the removal.
      const deleted = await this._repository.deleteChannel(organizationId, integrationId, true);
      this.revokeBestEffort(provider, row, [integrationId]);
      return deleted;
    }
    this.requireEnabled();
    if (!provider.revokeAuthorization) throw new HttpException('Provider data removal is unavailable. Please contact support.', HttpStatus.SERVICE_UNAVAILABLE);
    const marked = await this._repository.markAuthorizationDeletionRequested(organizationId, integrationId, expectedToken);
    if (!marked.matched) return { id: integrationId };
    try {
      await this._temporalService.client.getRawClient().workflow.start('integrationDataDeletionWorkflowV1', {
        workflowId: `integration-data-delete_${integrationId}`,
        taskQueue: 'main',
        args: [{ organizationId, integrationId }],
      });
    } catch (error: any) {
      if (error?.name !== 'WorkflowExecutionAlreadyStartedError') {
        // The tombstone remains, and maintenance retries enqueueing it. Never
        // include SDK errors or credentials in the HTTP/Temporal failure.
        throw new HttpException('Provider data removal is pending. Please try again later.', HttpStatus.SERVICE_UNAVAILABLE);
      }
    }
    return { id: integrationId };
  }

  async requestOrganizationDeletion(organizationId: string): Promise<string[]> {
    const rows = await this._repository.getAuthorizationIntegrationsForOrganization(organizationId);
    const owned = rows.filter((row) => !!this._manager.getSocialIntegration(row.providerIdentifier)?.authorizationPolicy);
    if (owned.length) this.requireEnabled();
    // Providers outside the managed lifecycle that can revoke their grant:
    // best effort before the caller erases these channels' credentials
    for (const row of rows) {
      const provider = this._manager.getSocialIntegration(row.providerIdentifier);
      if (provider?.authorizationPolicy || !provider?.revokeAuthorization) continue;
      try {
        const full = await this._repository.getIntegrationForCleanup(organizationId, row.id);
        if (full && (full.token || full.refreshToken)) await this.revokeBestEffort(provider, full, rows.map((r) => r.id));
      } catch {
        /**empty**/
      }
    }
    for (const row of owned) await this.requestDeletion(organizationId, row.id);
    return owned.map((row) => row.id);
  }

  private async stopWorkflow(workflowId: string, runId?: string): Promise<'closed' | 'terminated' | 'pending'> {
    try {
      const handle = this._temporalService.client.getRawClient().workflow.getHandle(workflowId, runId);
      const { status } = await handle.describe();
      if (['COMPLETED', 'FAILED', 'CANCELLED', 'CANCELED', 'TERMINATED', 'CONTINUED_AS_NEW', 'TIMED_OUT'].includes(status.name)) return 'closed';
      if (status.name !== 'RUNNING') return 'pending';
      await handle.terminate('Provider connection removed');
      return 'terminated';
    } catch (error: any) {
      return error?.name === 'WorkflowNotFoundError' ? 'closed' : 'pending';
    }
  }

  private closeRelatedWorkflows(organizationId: string, integrationId: string, posts: string[]) {
    return this.closeWorkflows(organizationId, [integrationId], posts);
  }

  // Also used by the operator erasure command, which closes the workflows of a
  // whole organization at once. extraWorkflowIds are exact ids to stop as well.
  async closeWorkflows(organizationId: string, integrationIds: string[], posts: string[], extraWorkflowIds: string[] = []) {
    const postIds = new Set(posts);
    const related = new Map<string, string | undefined>([
      ...integrationIds.map((id) => [`refresh_${id}`, undefined] as [string, undefined]),
      ...posts.map((id) => [`post_${id}`, undefined] as [string, undefined]),
      ...extraWorkflowIds.map((id) => [id, undefined] as [string, undefined]),
    ]);
    // Use only built-in Visibility filtering: self-hosted deployments may not
    // have custom postId attributes registered. Prefixes also identify ABANDON
    // recurring children created by every existing post workflow version, their
    // ids are post_<cuid>_<random>, and a cuid never contains an underscore.
    for await (const execution of this._temporalService.client.getRawClient().workflow.list({ query: 'ExecutionStatus = "Running"' })) {
      const attributes = execution.searchAttributes;
      const byPost = attributes?.organizationId?.some((id) => String(id) === organizationId) && attributes?.postId?.some((id) => postIds.has(String(id)));
      const rest = execution.workflowId.startsWith('post_') ? execution.workflowId.slice('post_'.length) : undefined;
      const byId = rest !== undefined && (postIds.has(rest) || postIds.has(rest.split('_')[0]));
      if (byPost || byId) {
        related.set(execution.workflowId, execution.runId);
      }
    }
    // Chunked: an organization can have thousands of posts
    const entries = [...related];
    const outcomes: ('closed' | 'terminated' | 'pending')[] = [];
    for (let i = 0; i < entries.length; i += 50) {
      outcomes.push(...(await Promise.all(entries.slice(i, i + 50).map(([id, runId]) => this.stopWorkflow(id, runId)))));
    }
    return { stopped: !outcomes.includes('pending'), newlyStopped: outcomes.includes('terminated'), terminated: outcomes.filter((outcome) => outcome === 'terminated').length, pending: outcomes.filter((outcome) => outcome === 'pending').length };
  }

  async purgeAnalytics(organizationId: string, ids: string[]) {
    for (const id of ids) {
      let cursor = '0';
      do {
        const [next, keys] = await ioRedis.scan(cursor, 'MATCH', `integration:${organizationId}:${id}:*`, 'COUNT', 100);
        if (keys.length) await ioRedis.del(...keys);
        cursor = next;
      } while (cursor !== '0');
    }
  }

  private ownedAvatar(picture?: string | null): boolean {
    return !!picture && isOwnedIntegrationPicture(picture);
  }

  private historyExpired(updatedAt?: Date | null) {
    const hours = Number(process.env.INTEGRATION_AUTHORIZATION_HISTORY_RETENTION_HOURS);
    // This value is enabled only after an operator verifies actual namespace
    // retention and archival settings. Keep a one-hour margin after expiry.
    return Number.isFinite(hours) && hours > 0 && hours <= 144 && !!updatedAt &&
      Date.now() - new Date(updatedAt).getTime() >= (hours + 1) * 60 * 60 * 1000;
  }

  private async digestHistorySettled(organizationId: string) {
    // v1 and v2 runs may still exist next to the v3 digest, all must be settled
    for (const workflowId of [
      `digest_email_workflow_${organizationId}`,
      `digest_email_workflow_v2_${organizationId}`,
      `digest_email_workflow_v3_${organizationId}`,
    ]) {
      try {
        const description = await this._temporalService.client.getRawClient().workflow.getHandle(workflowId).describe();
        // A shared digest can contain other owners' queued messages. Do not
        // terminate it or assume its payload was migrated to sanitized content.
        if (description.status.name === 'RUNNING' || !this.historyExpired(description.closeTime)) {
          return false;
        }
      } catch (error: any) {
        if (error?.name !== 'WorkflowNotFoundError') {
          return false;
        }
      }
    }
    return true;
  }

  private async queueVerifiedGrantSiblings(row: CleanupRow | null) {
    if (!row) return;
    const provider = this._manager.getSocialIntegration(row.providerIdentifier);
    if (!provider?.getAuthorizationGrant) return;
    const grant = await provider.getAuthorizationGrant(this.credentials(row)).catch(() => undefined);
    if (!grant || !row.rootInternalId || grant.subject !== row.rootInternalId ||
      grant.realm !== provider.authorizationPolicy?.authorizationRealm) return;
    const candidates = await this._repository.findAuthorizationGrantCandidates(grant.subject);
    for (const candidate of candidates) {
      if (candidate.id === row.id) continue;
      const siblingProvider = this._manager.getSocialIntegration(candidate.providerIdentifier);
      if (siblingProvider?.authorizationPolicy?.authorizationRealm !== grant.realm ||
        !siblingProvider.getAuthorizationGrant) continue;
      const siblingGrant = await siblingProvider.getAuthorizationGrant(this.credentials(candidate)).catch(() => undefined);
      if (siblingGrant?.realm === grant.realm && siblingGrant.subject === grant.subject) {
        await this.requestDeletion(candidate.organizationId, candidate.id, candidate.token);
      }
    }
  }

  async processDeletion(organizationId: string, integrationId: string): Promise<{ status: 'complete' | 'pending' }> {
    if (!this.enabled()) return { status: 'pending' };
    const row = await this._repository.getIntegrationForCleanup(organizationId, integrationId);
    if (!row || !row.deletedAt) return { status: 'complete' };
    // deleted, but the disconnect that sets the other two flags has not landed
    if (!isChannelDisconnected(row)) return { status: 'pending' };
    try {
      const posts = await this._repository.getAuthorizationPostIds(organizationId, integrationId);
      const stopped = await this.closeRelatedWorkflows(organizationId, integrationId, posts);
      if (!stopped.stopped) return { status: 'pending' };
      if (!row.token && !row.refreshToken) {
        if (row.internalId !== `erased_${row.id}`) return { status: 'pending' };
        if (stopped.newlyStopped) {
          await this._repository.touchAuthorizationHistoryWait(organizationId, integrationId);
          return { status: 'pending' };
        }
        const notifications = await this._repository.purgeAuthorizationNotifications(organizationId, integrationId);
        return { status: !notifications.unattributed && this.historyExpired(row.updatedAt) && await this.digestHistorySettled(organizationId) ? 'complete' : 'pending' };
      }
      const provider = this._manager.getSocialIntegration(row.providerIdentifier);
      if (!provider?.authorizationPolicy || !provider.revokeAuthorization) return { status: 'pending' };
      // While a channel outside the managed lifecycle still uses the grant,
      // it is kept for it: no revocation and no sibling removal, this
      // channel's data is still removed below.
      if (!(await this.grantStillInUse(provider, row, [integrationId], true))) {
        // Verify any cross-organization grouping before revoking a project-wide
        // grant. A stored or hashed principal alone is never sufficient proof.
        await this.queueVerifiedGrantSiblings(row);
        const result = await provider.revokeAuthorization(this.credentials(row));
        if (result.status !== 'revoked') return { status: 'pending' };
      }
      const notifications = await this._repository.purgeAuthorizationNotifications(organizationId, integrationId);
      if (notifications.unattributed) return { status: 'pending' };
      await this.purgeAnalytics(organizationId, [integrationId, ...posts]);
      if (this.ownedAvatar(row.picture) && !(await this._repository.hasAvatarReferences(row.picture!, integrationId))) {
        await this.storage.removeFile(row.picture!);
      }
      await this._repository.scrubAuthorizationData(organizationId, integrationId);
      // Older publishing workflows contain API data in their histories. They
      // have been stopped above; completion waits for verified history expiry.
      return { status: 'pending' };
    } catch {
      return { status: 'pending' };
    }
  }

  async checkAuthorizationsPage(cursor?: string): Promise<{ cursor?: string; checked: number; pending: number }> {
    if (!this.enabled()) return { checked: 0, pending: 0 };
    const rows = await this._repository.getAuthorizationIntegrationsPage(cursor);
    let checked = 0;
    let pending = 0;
    for (const row of rows) {
      const provider = this._manager.getSocialIntegration(row.providerIdentifier);
      if (!provider?.authorizationPolicy || !provider.checkAuthorization) continue;
      // Stored credentials that cannot be decrypted say nothing about the
      // provider grant: never check, update or delete from them.
      if (row.credentialsUnreadable) { pending++; continue; }
      if (row.deletedAt) {
        if (isChannelDisconnected(row) && (row.token || row.refreshToken)) {
          await this.requestDeletion(row.organizationId, row.id).catch(() => { pending++; });
        }
        continue;
      }
      checked++;
      try {
        const result = await provider.checkAuthorization(this.credentials(row));
        if (result.status === 'unknown') { pending++; continue; }
        if (result.status === 'revoked') {
          await this.requestDeletion(row.organizationId, row.id, row.token);
          continue;
        }
        if (result.identity?.picture && result.identity.picture !== row.picture &&
          this.ownedAvatar(row.picture) && !(await this._repository.hasAvatarReferences(row.picture!, row.id))) {
          await this.storage.removeFile(row.picture!);
        }
        await this._repository.updateAuthorizationIfActive(row.organizationId, row.id, result.credentials, result.identity, row.token);
      } catch {
        pending++;
      }
    }
    return { ...(rows.length === 100 ? { cursor: rows[rows.length - 1].id } : {}), checked, pending };
  }
}
