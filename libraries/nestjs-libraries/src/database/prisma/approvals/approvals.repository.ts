import { Injectable } from '@nestjs/common';
import { ApprovalStatus, Prisma, Role, State } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export interface ApprovalSettingsData {
  requireApproval: boolean;
  approverIds: string[];
  requireAgentApproval: boolean;
  requireApiApproval: boolean;
  agentIntegrationIds: string[];
  agentMaxPostsPerDay: number | null;
}

// the statuses that keep a post in the review queue
export const REVIEW_QUEUE: ApprovalStatus[] = ['IN_REVIEW', 'CHANGES_REQUESTED'];

@Injectable()
export class ApprovalsRepository {
  constructor(
    private _settings: PrismaRepository<'approvalSettings'>,
    private _links: PrismaRepository<'approvalLink'>,
    private _post: PrismaRepository<'post'>,
    private _userOrg: PrismaRepository<'userOrganization'>,
    private _integration: PrismaRepository<'integration'>,
    private _organization: PrismaRepository<'organization'>
  ) {}

  getSettings(organizationId: string) {
    return this._settings.model.approvalSettings.findUnique({
      where: { organizationId },
    });
  }

  upsertSettings(organizationId: string, data: ApprovalSettingsData) {
    return this._settings.model.approvalSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }

  getMembers(organizationId: string) {
    return this._userOrg.model.userOrganization.findMany({
      where: {
        organizationId,
        disabled: false,
        user: { deletedAt: null },
      },
      select: {
        role: true,
        user: {
          select: { id: true, email: true, name: true, lastName: true },
        },
      },
    });
  }

  getMember(organizationId: string, userId: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        organizationId,
        userId,
        disabled: false,
        user: { deletedAt: null },
      },
      select: {
        role: true,
        user: {
          select: { id: true, email: true, name: true, lastName: true },
        },
      },
    });
  }

  // Admins always approve, plus the members picked in the settings
  getApprovers(organizationId: string, approverIds: string[]) {
    return this._userOrg.model.userOrganization.findMany({
      where: {
        organizationId,
        disabled: false,
        user: { deletedAt: null },
        OR: [
          { role: { in: [Role.SUPERADMIN, Role.ADMIN] } },
          ...(approverIds.length ? [{ userId: { in: approverIds } }] : []),
        ],
      },
      select: {
        user: { select: { id: true, email: true } },
      },
    });
  }

  getRootPost(organizationId: string, postId: string) {
    return this._post.model.post.findFirst({
      where: {
        id: postId,
        organizationId,
        deletedAt: null,
        parentPostId: null,
        integration: { deletedAt: null },
      },
      select: {
        id: true,
        group: true,
        state: true,
        approvalStatus: true,
        publishDate: true,
        content: true,
        agentSource: true,
        organizationId: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
          },
        },
      },
    });
  }

  // A post and its comments move together, they share the group. The main
  // post is claimed first, only when it still matches `expected`, so two
  // people acting at once can't both approve (and publish) it.
  async transitionGroup(
    organizationId: string,
    post: { id: string; group: string },
    expected: Prisma.PostWhereInput,
    data: { state: State; approvalStatus: ApprovalStatus; publishDate?: Date }
  ) {
    const claimed = await this._post.model.post.updateMany({
      where: {
        AND: [expected, { id: post.id, organizationId, deletedAt: null }],
      },
      data,
    });
    if (!claimed.count) {
      return false;
    }
    await this._post.model.post.updateMany({
      where: {
        organizationId,
        group: post.group,
        deletedAt: null,
        id: { not: post.id },
      },
      data,
    });
    return true;
  }

  getReviewQueue(organizationId: string, agentOnly: boolean) {
    return this._post.model.post.findMany({
      where: {
        organizationId,
        deletedAt: null,
        parentPostId: null,
        approvalStatus: { in: REVIEW_QUEUE },
        integration: { deletedAt: null },
        ...(agentOnly ? { agentSource: { not: null } } : {}),
      },
      orderBy: { publishDate: 'asc' },
      take: 200,
      select: {
        id: true,
        group: true,
        content: true,
        image: true,
        publishDate: true,
        approvalStatus: true,
        agentSource: true,
        creationMethod: true,
        createdAt: true,
        integration: {
          select: {
            id: true,
            name: true,
            picture: true,
            providerIdentifier: true,
          },
        },
      },
    });
  }

  countReviewQueue(organizationId: string) {
    return this._post.model.post.count({
      where: {
        organizationId,
        deletedAt: null,
        parentPostId: null,
        approvalStatus: 'IN_REVIEW',
        integration: { deletedAt: null },
      },
    });
  }

  // Deleted posts count too, deleting must not hand an agent its quota back
  countAgentPostsSince(organizationId: string, since: Date) {
    return this._post.model.post.count({
      where: {
        organizationId,
        parentPostId: null,
        agentSource: { not: null },
        createdAt: { gte: since },
      },
    });
  }

  getIntegrationNames(organizationId: string, ids: string[]) {
    return this._integration.model.integration.findMany({
      where: { organizationId, id: { in: ids }, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  createLink(data: {
    organizationId: string;
    tokenHash: string;
    postIds: string[];
    createdById: string;
    expiresAt: Date;
  }) {
    return this._links.model.approvalLink.create({
      data,
      select: { id: true, expiresAt: true, postIds: true, createdAt: true },
    });
  }

  listLinks(organizationId: string) {
    return this._links.model.approvalLink.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        postIds: true,
        expiresAt: true,
        revokedAt: true,
        lastViewedAt: true,
        createdAt: true,
      },
    });
  }

  revokeLink(organizationId: string, id: string) {
    return this._links.model.approvalLink.updateMany({
      where: { organizationId, id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  getLinkByHash(tokenHash: string) {
    return this._links.model.approvalLink.findUnique({
      where: { tokenHash },
    });
  }

  touchLink(id: string) {
    return this._links.model.approvalLink.update({
      where: { id },
      data: { lastViewedAt: new Date() },
      select: { id: true },
    });
  }

  getOrganizationName(organizationId: string) {
    return this._organization.model.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
  }
}
