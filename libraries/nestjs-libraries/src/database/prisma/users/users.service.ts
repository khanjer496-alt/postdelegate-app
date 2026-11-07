import { HttpException, Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { Provider, Role } from '@prisma/client';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';
import { TimezoneDto } from '@gitroom/nestjs-libraries/dtos/users/timezone.dto';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { IntegrationAuthorizationLifecycleService } from '@gitroom/nestjs-libraries/integrations/integration.authorization.lifecycle.service';

@Injectable()
export class UsersService {
  constructor(
    private _usersRepository: UsersRepository,
    private _organizationRepository: OrganizationRepository,
    private _integrationRepository: IntegrationRepository,
    private _notificationService: NotificationService,
    private _authorizationLifecycle: IntegrationAuthorizationLifecycleService
  ) {}

  private readonly _logger = new Logger(UsersService.name);

  getUserByEmail(email: string) {
    return this._usersRepository.getUserByEmail(email);
  }

  getProviderUserByEmail(email: string) {
    return this._usersRepository.getProviderUserByEmail(email);
  }

  getUserById(id: string) {
    return this._usersRepository.getUserById(id);
  }

  // One free trial per owner email, across all the logins and workspaces that
  // share it
  async canStartTrial(organization: { id: string; allowTrial: boolean }) {
    return (
      organization.allowTrial &&
      !(await this._usersRepository.getUserWithUsedTrialByOrg(organization.id))
    );
  }

  getUserWithActiveSubscriptionByEmail(email: string, excludeUserId: string) {
    return this._usersRepository.getUserWithActiveSubscriptionByEmail(
      email,
      excludeUserId
    );
  }

  getImpersonateUser(name: string) {
    return this._organizationRepository.getImpersonateUser(name);
  }

  getUserByProvider(providerId: string, provider: Provider) {
    return this._usersRepository.getUserByProvider(providerId, provider);
  }

  async switchUser(
    currentUserId: string,
    targetUserId: string,
    adminId: string
  ) {
    const { kept, switched } =
      await this._usersRepository.switchUserCredentials(
        currentUserId,
        targetUserId
      );

    this._logger.log(
      `User login switch performed by admin ${adminId}: account ${
        kept.id
      } login ${switched.email} -> ${kept.email}; account ${
        switched.id
      } login ${kept.email} -> ${switched.email}`
    );

    // the swap is already committed; a notification failure must not fail it
    if (this._notificationService.hasEmailProvider()) {
      await Promise.all(
        [kept, switched].map((account) =>
          this._notificationService
            .sendEmail(
              account.email,
              'Your PostDelegate login was changed',
              `An administrator changed the login for your PostDelegate account. ` +
                `You can now sign in using ${account.email}. ` +
                `Your subscription and plan were not changed by this switch — ` +
                `if you intended to cancel a subscription, please do that ` +
                `separately from your billing settings.`
            )
            .catch((err) =>
              this._logger.error(`Failed to notify ${account.email}`, err)
            )
        )
      );
    }

    return { kept, switched };
  }

  async getOrgsToDeleteForAccount(userId: string) {
    const orgs = await this._organizationRepository.getOrgsByUserId(userId);
    const ownedOrgs = orgs.filter(
      (org) => org.users[0].role === Role.SUPERADMIN
    );

    const teams = await Promise.all(
      ownedOrgs.map((org) => this._organizationRepository.getTeam(org.id))
    );

    return ownedOrgs.filter(
      (org, index) =>
        !teams[index]?.users?.some(
          (member) =>
            member.user.id !== userId && member.role === Role.SUPERADMIN
        )
    );
  }

  // Workspaces the user is the only Super Admin of while other active people
  // use them. Like Slack, Notion and Buffer, they stay with their members, so
  // the account can't be deleted until someone else owns them
  async getSharedOwnedWorkspaces(userId: string) {
    const ownedOrgs = await this.getOrgsToDeleteForAccount(userId);
    const teams = await Promise.all(
      ownedOrgs.map((org) => this._organizationRepository.getActiveTeam(org.id))
    );
    return ownedOrgs
      .filter((org, index) =>
        teams[index]?.users?.some((member) => member.user.id !== userId)
      )
      .map((org) => ({
        id: org.id,
        // enterprise workspaces carry an internal suffix after ###
        name: org.name.split('###')[0],
      }));
  }

  async assertCanDeleteAccount(userId: string) {
    const shared = await this.getSharedOwnedWorkspaces(userId);
    if (!shared.length) {
      return;
    }
    const names = shared.map((org) => org.name);
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    throw new HttpException(
      `You own ${list} and other people use ${
        names.length === 1 ? 'it' : 'them'
      }. Make another member the owner in Settings → Team, or remove the other members, then delete your account.`,
      400
    );
  }

  async getDeleteAccountInfo(userId: string) {
    const ownedOrgs = await this.getOrgsToDeleteForAccount(userId);
    const teams = await Promise.all(
      ownedOrgs.map((org) => this._organizationRepository.getTeam(org.id))
    );

    return {
      hasSubscription: ownedOrgs.some((org) => !!org.subscription),
      hasAdditionalMembers: teams.some((team) =>
        team?.users?.some((member) => member.user.id !== userId)
      ),
      // shown before the confirmation, deleting is refused while non-empty
      sharedWorkspaces: (await this.getSharedOwnedWorkspaces(userId)).map(
        (org) => org.name
      ),
    };
  }

  async deleteAccount(userId: string) {
    await this.assertCanDeleteAccount(userId);
    const deletedOrgs = await this.getOrgsToDeleteForAccount(userId);
    const orgs = await this._organizationRepository.getOrgsByUserId(userId);

    // Capture durable revocation/cleanup work before any legacy hashing can
    // destroy the credentials it needs. Shared workspaces retain their channels.
    const lifecycleOwnedIds = new Map<string, string[]>();
    for (const org of deletedOrgs) {
      lifecycleOwnedIds.set(
        org.id,
        await this._authorizationLifecycle.requestOrganizationDeletion(org.id)
      );
    }

    for (const org of orgs) {
      if (deletedOrgs.some((deletedOrg) => deletedOrg.id === org.id)) {
        const team = await this._organizationRepository.getTeam(org.id);
        for (const member of team?.users || []) {
          if (member.user.id !== userId) {
            await this._organizationRepository.deleteTeamMember(
              org.id,
              member.user.id
            );
          }
        }

        await this._integrationRepository.deleteIntegrationsForAccount(
          org.id,
          lifecycleOwnedIds.get(org.id) || []
        );
        await this._organizationRepository.deleteOrganization(org.id);
      } else {
        await this._organizationRepository.deleteTeamMember(org.id, userId);
      }
    }

    await this._usersRepository.deleteAccount(userId);

    this._logger.log(
      `Account ${userId} deleted, organizations removed: ${deletedOrgs
        .map((org) => org.id)
        .join(', ')}`
    );

    return { deletedOrgs };
  }

  activateUser(id: string) {
    return this._usersRepository.activateUser(id);
  }

  updatePassword(id: string, password: string) {
    return this._usersRepository.updatePassword(id, password);
  }

  getPersonal(userId: string) {
    return this._usersRepository.getPersonal(userId);
  }

  changePersonal(userId: string, body: UserDetailDto) {
    return this._usersRepository.changePersonal(userId, body);
  }

  getEmailNotifications(userId: string) {
    return this._usersRepository.getEmailNotifications(userId);
  }

  updateEmailNotifications(userId: string, body: EmailNotificationsDto) {
    return this._usersRepository.updateEmailNotifications(userId, body);
  }

  signOutEverywhere(userId: string) {
    return this._usersRepository.signOutEverywhere(userId);
  }

  updateTimezone(userId: string, body: TimezoneDto) {
    return this._usersRepository.updateTimezone(userId, body);
  }
}
