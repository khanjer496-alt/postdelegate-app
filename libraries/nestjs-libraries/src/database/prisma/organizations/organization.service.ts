import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { HttpException, Injectable } from '@nestjs/common';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { AddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/add.team.member.dto';
import { AdminAddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/admin.add.team.member.dto';
import { ChangeTeamMemberRoleDto } from '@gitroom/nestjs-libraries/dtos/settings/change.team.member.role.dto';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import dayjs from 'dayjs';
import { escape } from 'lodash';
import { emailButton } from '@gitroom/nestjs-libraries/services/email.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Organization, ShortLinkPreference, User } from '@prisma/client';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';

@Injectable()
export class OrganizationService {
  constructor(
    private _organizationRepository: OrganizationRepository,
    private _notificationsService: NotificationService
  ) {}
  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & { providerId?: string },
    ip: string,
    userAgent: string
  ) {
    return this._organizationRepository.createOrgAndUser(
      body,
      this._notificationsService.hasEmailProvider(),
      ip,
      userAgent
    );
  }

  async getCount() {
    return this._organizationRepository.getCount();
  }

  async createMaxUser(id: string, name: string, saasName: string, email: string) {
    return this._organizationRepository.createMaxUser(id, name, saasName, email);
  }

  addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN',
    invitedEmail?: string
  ) {
    return this._organizationRepository.addUserToOrg(
      userId,
      id,
      orgId,
      role,
      invitedEmail
    );
  }

  getOrgById(id: string) {
    return this._organizationRepository.getOrgById(id);
  }

  getOrgByIdWithSubscription(id: string) {
    return this._organizationRepository.getOrgByIdWithSubscription(id);
  }

  getAccountOverview(orgId: string) {
    return this._organizationRepository.getAccountOverview(orgId);
  }

  // The readable API key, for the settings page and the enterprise webhook.
  // The stored column is not it: see OrganizationRepository.readApiKey.
  readApiKey(org?: { apiKey?: string | null } | null) {
    return this._organizationRepository.readApiKey(org);
  }

  getOrgByApiKey(api: string) {
    return this._organizationRepository.getOrgByApiKey(api);
  }

  async canUseSuperAdminApi(orgId: string) {
    const [superAdmin, privilegedOther] = await Promise.all([
      this._organizationRepository.getSuperAdminUser(orgId),
      this._organizationRepository.getPrivilegedNonSuperAdminUser(orgId),
    ]);

    return !!superAdmin && !privilegedOther;
  }

  getUserOrg(id: string) {
    return this._organizationRepository.getUserOrg(id);
  }

  getOrgsByUserId(userId: string) {
    return this._organizationRepository.getOrgsByUserId(userId);
  }

  updateApiKey(orgId: string) {
    return this._organizationRepository.updateApiKey(orgId);
  }

  getTeam(orgId: string) {
    return this._organizationRepository.getTeam(orgId);
  }

  getActiveTeam(orgId: string) {
    return this._organizationRepository.getActiveTeam(orgId);
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationRepository.setStreak(organizationId, type);
  }

  async getLastPublishDate(organizationId: string) {
    return this._organizationRepository.getLastPublishDate(organizationId);
  }

  getOrgByCustomerId(customerId: string) {
    return this._organizationRepository.getOrgByCustomerId(customerId);
  }

  async inviteTeamMember(org: Organization, user: User, body: AddTeamMemberDto) {
    const timeLimit = dayjs().add(2, 'day').format('YYYY-MM-DD HH:mm:ss');
    const id = makeId(5);
    // only the invite fields, the body can carry undeclared properties
    const url =
      process.env.FRONTEND_URL +
      `/?org=${AuthService.signTypedJWT('invite', {
        email: body.email,
        role: body.role,
        orgId: org.id,
        timeLimit,
        id,
      })}`;
    if (body.sendEmail) {
      const inviter = user.name
        ? `${user.name} (${user.email})`
        : user.email;
      await this._notificationsService.sendEmail(
        body.email,
        `${user.name || user.email} invited you to join "${org.name}"`,
        `${escape(inviter)} has invited you to join the "${escape(
          org.name
        )}" workspace on PostDelegate.${emailButton(
          url,
          'Accept the invitation'
        )}The link expires in 2 days.`
      );
    }
    return { url };
  }

  async addTeamMemberByEmail(org: Organization, body: AdminAddTeamMemberDto) {
    const tier =
      // @ts-ignore
      org?.subscription?.subscriptionTier ||
      (!process.env.STRIPE_PUBLISHABLE_KEY ? 'ULTIMATE' : 'FREE');

    if (!pricing[tier].team_members) {
      throw new HttpException(
        'The organization plan does not include team members',
        400
      );
    }

    const users = await this._organizationRepository.getUsersByEmail(
      body.email
    );
    if (!users.length) {
      throw new HttpException('No PostDelegate account found for this email', 400);
    }

    if (users.length > 1) {
      throw new HttpException(
        'Multiple accounts exist for this email (different login providers)',
        400
      );
    }

    const [user] = users;

    const userOrgs = await this._organizationRepository.getOrgsByUserId(
      user.id
    );
    if (userOrgs.some((current) => current.id === org.id)) {
      throw new HttpException(
        'User is already a member of this organization',
        400
      );
    }

    const added = await this._organizationRepository.addUserToOrg(
      user.id,
      makeId(5),
      org.id,
      body.role as 'USER' | 'ADMIN'
    );

    if ('failed' in added) {
      throw new HttpException(
        'Could not add the user to the organization',
        400
      );
    }

    return { added: true };
  }

  async deleteTeamMember(
    org: Organization,
    userId: string,
    actingUserId?: string
  ) {
    if (actingUserId && actingUserId === userId) {
      throw new HttpException(
        "You can't remove yourself from the workspace.",
        400
      );
    }

    const userOrgs = await this._organizationRepository.getOrgsByUserId(userId);
    const findOrgToDelete = userOrgs.find((orgUser) => orgUser.id === org.id);
    if (!findOrgToDelete) {
      throw new HttpException('User is not part of this organization', 404);
    }

    // @ts-ignore
    const myRole = org.users[0].role;
    const userRole = findOrgToDelete.users[0].role;
    const myLevel = myRole === 'USER' ? 0 : myRole === 'ADMIN' ? 1 : 2;
    const userLevel = userRole === 'USER' ? 0 : userRole === 'ADMIN' ? 1 : 2;

    // only someone above a member can remove them (an admin removes users,
    // a super admin removes admins and users), like the team page offers
    if (myLevel <= userLevel) {
      throw new HttpException(
        'You do not have permission to remove this member',
        403
      );
    }

    return this._organizationRepository.deleteTeamMember(org.id, userId);
  }

  // A Super Admin makes another active member a Super Admin (transferring
  // the workspace), or steps down to Admin once someone else owns it. Billing
  // belongs to the workspace, so nothing changes in Stripe
  async changeTeamMemberRole(
    org: Organization,
    userId: string,
    body: ChangeTeamMemberRoleDto
  ) {
    // @ts-ignore
    if (org.users?.[0]?.role !== 'SUPERADMIN') {
      throw new HttpException(
        'Only a Super Admin can change who owns the workspace.',
        403
      );
    }

    const member = await this._organizationRepository.getTeamMember(
      org.id,
      userId
    );
    if (!member || member.disabled || member.user?.deletedAt) {
      throw new HttpException(
        'Pick an active member of this workspace.',
        404
      );
    }

    if (member.role === body.role) {
      return { role: member.role };
    }

    let changed: { role: string } | null;
    try {
      changed = await this._organizationRepository.changeTeamMemberRole(
        org.id,
        userId,
        body.role
      );
    } catch (err) {
      // another role change in the workspace ran at the same moment
      if ((err as { code?: string })?.code === 'P2034') {
        throw new HttpException(
          'The team changed at the same time. Refresh and try again.',
          409
        );
      }
      throw err;
    }

    if (!changed) {
      throw new HttpException(
        'A workspace needs at least one Super Admin. Make another member the owner first.',
        400
      );
    }

    return changed;
  }

  disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    return this._organizationRepository.disableOrEnableNonSuperAdminUsers(
      orgId,
      disable
    );
  }

  getShortlinkPreference(orgId: string) {
    return this._organizationRepository.getShortlinkPreference(orgId);
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organizationRepository.updateShortlinkPreference(
      orgId,
      shortlink
    );
  }
}
