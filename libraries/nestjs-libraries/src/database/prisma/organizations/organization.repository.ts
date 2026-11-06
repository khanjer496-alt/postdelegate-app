import { PrismaRepository, PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Prisma, Role, ShortLinkPreference } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  evergreenShareDate,
  evergreenSharesDone,
} from '@gitroom/nestjs-libraries/database/prisma/posts/posts.evergreen.schedule';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// Why an invite could not be accepted, so the person can be told
export type InviteFailure =
  | 'wrong_email'
  | 'already_used'
  | 'already_member'
  | 'plan';

@Injectable()
export class OrganizationRepository {
  constructor(
    private _organization: PrismaRepository<'organization'>,
    private _userOrg: PrismaRepository<'userOrganization'>,
    private _user: PrismaRepository<'user'>,
    private _transaction: PrismaTransaction
  ) {}

  createMaxUser(id: string, name: string, saasName: string, email: string) {
    return this._organization.model.organization.create({
      select: {
        id: true,
        apiKey: true,
      },
      data: {
        name: name ? `${name}###${id}` : `Unnamed User###${id}`,
        apiKey: AuthService.fixedEncryption(makeSecureId(20)),
        isTrailing: false,
        approvalSettings: {
          create: { requireAgentApproval: true },
        },
        subscription: {
          create: {
            totalChannels: 1000000,
            subscriptionTier: 'ULTIMATE',
            isLifetime: true,
            period: 'YEARLY',
          },
        },
        users: {
          create: {
            role: Role.SUPERADMIN,
            user: {
              create: {
                activated: true,
                email: email
                  ? email.split('@').join(`+${saasName}@`)
                  : `${saasName}+` + makeId(10) + '@postdelegate.com',
                name: name ? `${name}###${id}` : `Unnamed User###${id}`,
                providerName: 'LOCAL',
                password: AuthService.hashPassword(makeSecureId(500)),
                timezone: 0,
              },
            },
          },
        },
      },
    });
  }

  getOrgByApiKey(api: string) {
    return this._organization.model.organization.findFirst({
      where: {
        apiKey: api,
        deletedAt: null,
      },
      include: {
        subscription: {
          select: {
            subscriptionTier: true,
            totalChannels: true,
            isLifetime: true,
          },
        },
      },
    });
  }

  getCount() {
    return this._organization.model.organization.count();
  }

  getSuperAdminUser(orgId: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        organizationId: orgId,
        disabled: false,
        user: {
          isSuperAdmin: true,
          deletedAt: null,
        },
      },
    });
  }

  getPrivilegedNonSuperAdminUser(orgId: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        organizationId: orgId,
        disabled: false,
        role: {
          in: [Role.SUPERADMIN, Role.ADMIN],
        },
        user: {
          isSuperAdmin: false,
          deletedAt: null,
        },
      },
    });
  }

  getUserOrg(id: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        id,
      },
      select: {
        user: true,
        organization: {
          include: {
            users: {
              select: {
                id: true,
                disabled: true,
                role: true,
                userId: true,
              },
            },
            subscription: {
              select: {
                subscriptionTier: true,
                totalChannels: true,
                isLifetime: true,
              },
            },
          },
        },
      },
    });
  }

  getImpersonateUser(name: string) {
    return this._userOrg.model.userOrganization.findMany({
      where: {
        OR: [
          {
            organizationId: {
              contains: name,
            },
          },
          {
            organization: {
              OR: [
                {
                  paymentId: {
                    equals: name,
                  },
                },
                {
                  subscription: {
                    identifier: {
                      equals: name,
                    },
                  },
                },
                {
                  Integration: {
                    some: {
                      id: name,
                    },
                  },
                },
                {
                  post: {
                    some: {
                      id: name,
                    },
                  },
                },
              ],
            },
          },
          {
            user: {
              OR: [
                {
                  name: {
                    contains: name,
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: name,
                    mode: 'insensitive',
                  },
                },
                {
                  id: {
                    contains: name,
                  },
                },
              ],
            },
          },
        ],
      },
      select: {
        id: true,
        role: true,
        disabled: true,
        organization: {
          select: {
            id: true,
            name: true,
            paymentId: true,
            deletedAt: true,
            subscription: {
              select: {
                subscriptionTier: true,
                identifier: true,
                isLifetime: true,
                period: true,
                cancelAt: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            activated: true,
            providerName: true,
            deletedAt: true,
          },
        },
      },
    });
  }

  updateApiKey(orgId: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        apiKey: AuthService.fixedEncryption(makeSecureId(20)),
      },
    });
  }

  async getOrgsByUserId(userId: string) {
    return this._organization.model.organization.findMany({
      where: {
        deletedAt: null,
        users: {
          some: {
            userId,
          },
        },
      },
      include: {
        users: {
          where: {
            userId,
          },
          select: {
            disabled: true,
            role: true,
          },
        },
        subscription: {
          select: {
            subscriptionTier: true,
            totalChannels: true,
            isLifetime: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getOrgById(id: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id,
      },
    });
  }

  getOrgByIdWithSubscription(id: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id,
      },
      include: {
        subscription: {
          select: {
            subscriptionTier: true,
            totalChannels: true,
            isLifetime: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getAccountOverview(orgId: string) {
    const [organization, members] = await Promise.all([
      this._organization.model.organization.findUnique({
        where: {
          id: orgId,
        },
        select: {
          id: true,
          name: true,
          createdAt: true,
          deletedAt: true,
          allowTrial: true,
          isTrailing: true,
          subscription: {
            select: {
              subscriptionTier: true,
              period: true,
              identifier: true,
              totalChannels: true,
              isLifetime: true,
              cancelAt: true,
              createdAt: true,
              updatedAt: true,
              deletedAt: true,
            },
          },
        },
      }),
      this._userOrg.model.userOrganization.findMany({
        where: {
          organizationId: orgId,
        },
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          role: true,
          disabled: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              activated: true,
              providerName: true,
              lastOnline: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    if (!organization) {
      return null;
    }

    const owner = members.find((member) => member.role === Role.SUPERADMIN);
    const lastOnlineMax = members.reduce<Date | null>(
      (latest, member) =>
        !latest || member.user.lastOnline > latest
          ? member.user.lastOnline
          : latest,
      null
    );

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        createdAt: organization.createdAt,
        deletedAt: organization.deletedAt,
        allowTrial: organization.allowTrial,
        isTrailing: organization.isTrailing,
      },
      subscription: organization.subscription || null,
      owner: owner
        ? {
            ...owner.user,
            role: owner.role,
            memberSince: owner.createdAt,
          }
        : null,
      users: {
        total: members.length,
        activated: members.filter((member) => member.user.activated).length,
        disabled: members.filter((member) => member.disabled).length,
        lastOnlineMax,
      },
    };
  }

  getUsersByEmail(email: string) {
    return this._user.model.user.findMany({
      where: {
        email,
      },
    });
  }

  async addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN',
    // the email the invite was issued for; invite links pass it so only the
    // invited person can accept (admin-initiated adds have no invite email)
    invitedEmail?: string
  ) {
    // first: someone who already joined (with this very invite or another
    // way) is not told the invite failed
    const alreadyMember = await this._userOrg.model.userOrganization.findFirst({
      where: {
        userId,
        organizationId: orgId,
      },
      select: {
        id: true,
      },
    });

    if (alreadyMember) {
      return { failed: 'already_member' as InviteFailure };
    }

    if (invitedEmail !== undefined) {
      const accepting = await this._user.model.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          email: true,
        },
      });

      if (
        !accepting ||
        typeof invitedEmail !== 'string' ||
        accepting.email.trim().toLowerCase() !==
          invitedEmail.trim().toLowerCase()
      ) {
        return { failed: 'wrong_email' as InviteFailure };
      }
    }

    const checkIfInviteExists = await this._user.model.user.findFirst({
      where: {
        inviteId: id,
      },
    });

    if (checkIfInviteExists) {
      return { failed: 'already_used' as InviteFailure };
    }

    const checkForSubscription =
      await this._organization.model.organization.findFirst({
        where: {
          id: orgId,
        },
        select: {
          subscription: true,
        },
      });

    // with billing on, only a live plan that includes team members takes
    // new members (FREE and lapsed workspaces have no subscription)
    const tier = checkForSubscription?.subscription?.subscriptionTier;
    if (
      process.env.STRIPE_PUBLISHABLE_KEY &&
      (!tier || !pricing[tier]?.team_members)
    ) {
      return { failed: 'plan' as InviteFailure };
    }

    // joining and burning the invite id happen together, so a half applied
    // accept can't leave the invite usable again
    const [create] = await this._transaction.model.$transaction([
      this._userOrg.model.userOrganization.create({
        data: {
          role,
          userId,
          organizationId: orgId,
        },
      }),
      this._user.model.user.update({
        where: {
          id: userId,
        },
        data: {
          inviteId: id,
        },
      }),
    ]);

    return create;
  }

  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & { providerId?: string },
    hasEmail: boolean,
    ip: string,
    userAgent: string
  ) {
    return this._organization.model.organization.create({
      data: {
        name: body.company,
        apiKey: AuthService.fixedEncryption(makeSecureId(20)),
        allowTrial: true,
        isTrailing: true,
        // new workspaces hold AI agent posts for review, older ones have no
        // row and keep publishing them directly
        approvalSettings: {
          create: { requireAgentApproval: true },
        },
        users: {
          create: {
            role: Role.SUPERADMIN,
            // the admin of a new workspace gets the Monday summary
            weeklySummaryEmails: true,
            user: {
              create: {
                activated: body.provider !== 'LOCAL' || !hasEmail,
                email: body.email,
                password: body.password
                  ? AuthService.hashPassword(body.password)
                  : '',
                providerName: body.provider,
                providerId: body.providerId || '',
                timezone: 0,
                ip,
                agent: userAgent,
              },
            },
          },
        },
      },
      select: {
        id: true,
        users: {
          select: {
            user: true,
          },
        },
      },
    });
  }

  getOrgByCustomerId(customerId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        paymentId: customerId,
      },
    });
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    try {
      await this._organization.model.organization.update({
        where: {
          id: organizationId,
          ...(type === 'start'
            ? {
                streakSince: null,
              }
            : {}),
        },
        data: {
          ...(type === 'end' ? { streakSince: null } : {}),
          ...(type === 'start' ? { streakSince: new Date() } : {}),
        },
      });
    } catch (err) {}
  }

  async getLastPublishDate(organizationId: string) {
    // Still publishing, or about to: a post scheduled exactly a day after the
    // previous one must not end the streak
    const lookahead = Date.now() + 5 * 60 * 1000;
    const [org, recurring] = await Promise.all([
      this._organization.model.organization.findUnique({
        where: {
          id: organizationId,
        },
        select: {
          post: {
            where: {
              deletedAt: null,
              parentPostId: null,
              intervalInDays: null,
              OR: [
                { state: 'PUBLISHED' },
                { state: 'QUEUE', publishDate: { lte: new Date(lookahead) } },
              ],
            },
            orderBy: {
              publishDate: 'desc',
            },
            take: 1,
            select: {
              publishDate: true,
            },
          },
        },
      }),
      // Recurring posts keep their first publishDate and are republished on
      // the interval grid, count their latest occurrence instead
      this._organization.model.organization.findUnique({
        where: {
          id: organizationId,
        },
        select: {
          post: {
            where: {
              deletedAt: null,
              parentPostId: null,
              intervalInDays: { not: null },
              state: { in: ['PUBLISHED', 'QUEUE'] },
              publishDate: { lte: new Date(lookahead) },
            },
            select: {
              publishDate: true,
              state: true,
              intervalInDays: true,
              evergreenMaxShares: true,
              evergreenUntil: true,
            },
          },
        },
      }),
    ]);

    const dates = [
      ...(org?.post || []).map((p) => p.publishDate.getTime()),
      // a QUEUE row has not published its first share yet; a published one
      // re-shares on the grid only until its evergreen limits stop it (an
      // ended or stopped evergreen post keeps intervalInDays)
      ...(recurring?.post || []).map((p) =>
        p.state === 'QUEUE'
          ? p.publishDate.getTime()
          : evergreenShareDate(
              p.publishDate,
              evergreenSharesDone(p.publishDate, p, lookahead),
              p.intervalInDays
            ).getTime()
      ),
    ];

    // Never in the future, the streak workflow sleeps until a day after it
    return dates.length ? Math.min(Math.max(...dates), Date.now()) : null;
  }

  async getTeam(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        users: {
          select: {
            role: true,
            disabled: true,
            user: {
              select: {
                email: true,
                id: true,
                sendSuccessEmails: true,
                sendFailureEmails: true,
                sendStreakEmails: true,
              },
            },
          },
        },
      },
    });
  }

  // a member of the workspace, with what decides whether they can own it
  getTeamMember(orgId: string, userId: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        organizationId: orgId,
        userId,
      },
      select: {
        role: true,
        disabled: true,
        user: {
          select: {
            deletedAt: true,
          },
        },
      },
    });
  }

  // Changes a member's role, but never leaves the workspace without an active
  // Super Admin (null then). The count and the update run in one serializable
  // transaction, so two owners demoting each other at once can't both pass:
  // one of them fails with a serialization error instead
  changeTeamMemberRole(orgId: string, userId: string, role: Role) {
    return this._transaction.model.$transaction(
      async (tx) => {
        const member = await tx.userOrganization.findFirst({
          where: { organizationId: orgId, userId },
          select: { role: true },
        });
        if (!member) {
          return null;
        }
        if (member.role === Role.SUPERADMIN && role !== Role.SUPERADMIN) {
          const owners = await tx.userOrganization.count({
            where: {
              organizationId: orgId,
              role: Role.SUPERADMIN,
              disabled: false,
              user: {
                deletedAt: null,
              },
            },
          });
          if (owners <= 1) {
            return null;
          }
        }
        return tx.userOrganization.update({
          where: {
            userId_organizationId: {
              userId,
              organizationId: orgId,
            },
          },
          data: {
            role,
          },
          select: {
            role: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  // the members who still get the workspace's emails (digest, streak):
  // not disabled, not deleted
  getActiveTeam(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        users: {
          where: {
            disabled: false,
            user: {
              deletedAt: null,
            },
          },
          select: {
            role: true,
            user: {
              select: {
                email: true,
                id: true,
                sendSuccessEmails: true,
                sendFailureEmails: true,
                sendStreakEmails: true,
              },
            },
          },
        },
      },
    });
  }

  getOrgAdmins(orgId: string) {
    return this._userOrg.model.userOrganization.findMany({
      where: {
        organizationId: orgId,
        disabled: false,
        role: {
          in: [Role.SUPERADMIN, Role.ADMIN],
        },
        user: {
          deletedAt: null,
        },
      },
      select: {
        user: {
          select: {
            email: true,
          },
        },
      },
    });
  }

  getAllUsersOrgs(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        users: {
          // a disabled member or a deleted account gets no post emails
          where: {
            disabled: false,
            user: {
              deletedAt: null,
            },
          },
          select: {
            user: {
              select: {
                email: true,
                id: true,
                sendSuccessEmails: true,
                sendFailureEmails: true,
              },
            },
          },
        },
      },
    });
  }

  deleteOrganization(orgId: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async deleteTeamMember(orgId: string, userId: string) {
    return this._userOrg.model.userOrganization.delete({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId,
        },
      },
    });
  }

  disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    return this._userOrg.model.userOrganization.updateMany({
      where: {
        organizationId: orgId,
        role: {
          not: Role.SUPERADMIN,
        },
      },
      data: {
        disabled: disable,
      },
    });
  }

  getShortlinkPreference(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        shortlink: true,
      },
    });
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        shortlink,
      },
    });
  }
}
