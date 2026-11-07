import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { CHANNEL_CONNECTED } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';

@Injectable()
export class TrialOnboardingRepository {
  constructor(
    private _subscription: PrismaRepository<'subscription'>,
    private _trialOnboardingEmail: PrismaRepository<'trialOnboardingEmail'>,
    private _userOrg: PrismaRepository<'userOrganization'>,
    private _integration: PrismaRepository<'integration'>,
    private _post: PrismaRepository<'post'>,
    private _approvalSettings: PrismaRepository<'approvalSettings'>
  ) {}

  // The workspaces whose trial started in the window and that didn't get this
  // step yet, a page at a time. The subscription row is created when the trial
  // starts, and a workspace that pays, ends its trial or cancels it drops out.
  getTrials(
    step: string,
    from: Date,
    to: Date,
    cursor: string | undefined,
    take: number
  ) {
    return this._subscription.model.subscription.findMany({
      where: {
        deletedAt: null,
        isLifetime: false,
        cancelAt: null,
        createdAt: {
          gte: from,
          lt: to,
        },
        organization: {
          deletedAt: null,
          isTrailing: true,
          trialOnboardingEmails: {
            none: {
              step,
            },
          },
        },
        // a plain id comparison, as a claimed row drops out of this filter
        // and a cursor on it would skip the next one
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        organization: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        id: 'asc',
      },
      take,
    });
  }

  // the admins who can act on the tips, like the billing emails, minus the
  // ones who switched the getting started emails off
  getRecipients(orgId: string) {
    return this._userOrg.model.userOrganization.findMany({
      where: {
        organizationId: orgId,
        disabled: false,
        role: {
          in: [Role.SUPERADMIN, Role.ADMIN],
        },
        user: {
          deletedAt: null,
          activated: true,
          sendOnboardingEmails: true,
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

  // channels that can publish: not removed, switched off or half connected
  countChannels(orgId: string) {
    return this._integration.model.integration.count({
      where: {
        organizationId: orgId,
        ...CHANNEL_CONNECTED,
      },
    });
  }

  // whether posts from AI agents wait for approval; a workspace without a
  // settings row publishes them directly
  getAgentApproval(orgId: string) {
    return this._approvalSettings.model.approvalSettings.findUnique({
      where: {
        organizationId: orgId,
      },
      select: {
        requireAgentApproval: true,
      },
    });
  }

  countPosts(orgId: string) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
  }

  // The unique (organization, step) row makes the claim atomic: a retried or
  // a concurrent run finds the step taken and sends nothing
  async claimSend(orgId: string, step: string) {
    try {
      await this._trialOnboardingEmail.model.trialOnboardingEmail.create({
        data: {
          organizationId: orgId,
          step,
        },
        select: {
          id: true,
        },
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      throw err;
    }
  }
}
