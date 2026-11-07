import { PrismaRepository, PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Post as PostBody } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import {
  APPROVED_SUBMIT_FOR_ORDER,
  ApprovalStatus,
  CreationMethod,
  Post,
  Prisma,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import utc from 'dayjs/plugin/utc';
import { v4 as uuidv4 } from 'uuid';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import { decryptIntegrationOf } from '@gitroom/nestjs-libraries/database/prisma/integrations/token.encryption';
import { evergreenOccurrences } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.evergreen.schedule';
import { curatedPostError } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.curated.error';
import { auditErrorBody } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.audit.body';
import { CHANNEL_READY } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);
dayjs.extend(utc);

// Who a post read is for. A real organization id scopes the read to that
// tenant; PUBLIC_PREVIEW is the one deliberate exception - the shared preview
// page, which anyone holding the link may open. It is a visible argument rather
// than an omitted one, so a reader of any call site can tell which it is, and
// `grep PUBLIC_PREVIEW` lists every cross-tenant read in the codebase.
//
// The literal can never collide with a real organization id, which is a uuid.
export const PUBLIC_PREVIEW = '__public_preview__' as const;
export type OrgScope = string | typeof PUBLIC_PREVIEW;

export const orgFilter = (scope: OrgScope) =>
  scope === PUBLIC_PREVIEW ? {} : { organizationId: scope };

@Injectable()
export class PostsRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _popularPosts: PrismaRepository<'popularPosts'>,
    private _comments: PrismaRepository<'comments'>,
    private _tags: PrismaRepository<'tags'>,
    private _tagsPosts: PrismaRepository<'tagsPosts'>,
    private _errors: PrismaRepository<'errors'>,
    private _transaction: PrismaTransaction,
    private _providerPostUsage: PrismaRepository<'providerPostUsage'>
  ) {}

  private async updateActivePost(
    id: string,
    data: Prisma.PostUpdateManyMutationInput,
    conditions: Prisma.PostWhereInput = {},
    includeProvider = false,
    audit?: { message: string; body: string }
  ) {
    return this._transaction.model.$transaction(async (tx) => {
      const post = await tx.post.findUnique({
        where: { id },
        select: { integrationId: true },
      });
      if (!post) throw new BadRequestException('Post is no longer available.');

      // Lock the active connection for this short transaction. Deletion uses
      // the same integration row, so it either precedes this write (no match)
      // or follows the committed result and removes it during cleanup.
      const connection = await tx.integration.updateMany({
        where: { id: post.integrationId, deletedAt: null },
        data: { deletedAt: null },
      });
      if (!connection.count) {
        throw new BadRequestException('Post is no longer available.');
      }
      const changed = await tx.post.updateMany({
        where: {
          id,
          AND: [conditions, { integrationId: post.integrationId }],
          deletedAt: null,
          integration: { deletedAt: null },
        },
        data,
      });
      if (!changed.count) {
        throw new BadRequestException('Post is no longer available.');
      }

      const updated = await tx.post.findUnique({ where: { id } });
      if (!includeProvider) return updated;
      const integration = await tx.integration.findUnique({
        where: { id: post.integrationId },
        select: { providerIdentifier: true },
      });
      if (audit) {
        await tx.errors.create({
          data: {
            ...audit,
            organizationId: updated!.organizationId,
            platform: integration!.providerIdentifier,
            postId: id,
          },
        });
      }
      return { ...updated!, integration };
    });
  }

  searchForMissingThreeHoursPosts() {
    return this._post.model.post.findMany({
      where: {
        integration: { ...CHANNEL_READY },
        publishDate: {
          gte: dayjs.utc().subtract(2, 'day').toDate(),
          lt: dayjs.utc().toDate(),
        },
        state: 'QUEUE',
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        organizationId: true,
        integration: {
          select: {
            providerIdentifier: true,
          },
        },
        publishDate: true,
      },
    });
  }

  getOldPosts(orgId: string, date: string) {
    return this._post.model.post.findMany({
      where: {
        // this one used to leave out deletedAt, so it returned the old posts
        // of channels the customer had already removed
        integration: { ...CHANNEL_READY },
        organizationId: orgId,
        publishDate: {
          lte: dayjs(date).toDate(),
        },
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: {
        publishDate: 'desc',
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  updateImages(id: string, images: string) {
    return this.updateActivePost(id, { image: images });
  }

  getPostUrls(orgId: string, ids: string[]) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        releaseURL: true,
      },
    });
  }

  // withPreview adds the media of the posts, for the calendar preview
  async getPosts(orgId: string, query: GetPostsDto, withPreview = false) {
    // Use the provided start and end dates directly
    const startDate = dayjs.utc(query.startDate).toDate();
    const endDate = dayjs.utc(query.endDate).toDate();

    const list = await this._post.model.post.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                organizationId: orgId,
              },
            ],
          },
          {
            OR: [
              {
                publishDate: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                intervalInDays: {
                  not: null,
                },
              },
            ],
          },
        ],
        integration: {
          deletedAt: null,
          organizationId: orgId,
          ...(query.customer ? { customerId: query.customer } : {}),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        image: withPreview,
        publishDate: true,
        releaseURL: true,
        releaseId: true,
        state: true,
        error: true,
        intervalInDays: true,
        evergreenMaxShares: true,
        evergreenUntil: true,
        group: true,
        creationMethod: true,
        approvalStatus: true,
        agentSource: true,
        settings: true,
        tags: {
          where: {
            tag: {
              deletedAt: null,
            },
          },
          select: {
            tag: true,
          },
        },
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            name: true,
            picture: true,
          },
        },
      },
    });

    // This runs on the request thread, so keep it linear: push into one array
    // (spreading the accumulator on every post was quadratic and blocked the
    // event loop for seconds on large orgs), and expand repeating posts only
    // inside [startDate, endDate] instead of from their first publish date.
    const result: any[] = [];

    for (const row of list) {
      const post = { ...row, error: curatedPostError(row.error) };
      if (!post.intervalInDays || post.intervalInDays < 1) {
        result.push(post);
        continue;
      }

      // evergreenOccurrences stops after the post's last share, which the
      // plain interval walk upstream uses does not know about, and takes the
      // same rangeStart skip so nothing before the window is built at all
      for (const date of evergreenOccurrences(
        post.publishDate,
        post,
        endDate,
        startDate
      )) {
        result.push({
          ...post,
          publishDate: date,
          actualDate: post.publishDate,
        });
      }
    }

    return result;
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    const page = query.page || 0;
    const limit = query.limit || 20;
    const skip = page * limit;

    const stateFilter = query.state || 'all';
    const stateAndDate =
      stateFilter === 'scheduled'
        ? {
            state: State.QUEUE,
          }
        : stateFilter === 'draft'
        ? { state: State.DRAFT }
        : stateFilter === 'published'
        ? { state: State.PUBLISHED }
        : {
            state: {
              in: [State.QUEUE, State.DRAFT, State.PUBLISHED, State.ERROR],
            },
          };

    const orderDirection: 'asc' | 'desc' =
      stateFilter === 'published' ? 'desc' : 'asc';

    const where = {
      AND: [
        {
          OR: [
            {
              organizationId: orgId,
            },
          ],
        },
      ],
      ...stateAndDate,
      // Published posts were already posted (publishDate in the past), so fetch
      // all of them; everything else stays upcoming. Ordering handles the rest.
      ...(stateFilter === 'published'
        ? {}
        : { publishDate: { gte: dayjs.utc().toDate() } }),
      deletedAt: null as Date | null,
      parentPostId: null as string | null,
      intervalInDays: null as number | null,

      integration: {
        deletedAt: null as any,
        organizationId: orgId,
        ...(query.customer
          ? {
              customerId: query.customer,
            }
          : {}),
        ...(query.integrations
          ? {
              id: { in: query.integrations },
            }
          : {}),
      },
      ...(query.tags?.length
        ? {
            tags: {
              some: {
                tagId: { in: query.tags },
                tag: { orgId, deletedAt: null as Date | null },
              },
            },
          }
        : {}),
    };

    const [posts, total] = await Promise.all([
      this._post.model.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          publishDate: orderDirection,
        },
        select: {
          id: true,
          content: true,
          image: true,
          publishDate: true,
          releaseURL: true,
          releaseId: true,
          state: true,
          intervalInDays: true,
          group: true,
          creationMethod: true,
          approvalStatus: true,
          agentSource: true,
          tags: {
            where: {
              tag: {
                deletedAt: null,
              },
            },
            select: {
              tag: true,
            },
          },
          integration: {
            select: {
              id: true,
              providerIdentifier: true,
              name: true,
              picture: true,
            },
          },
        },
      }),
      this._post.model.post.count({ where }),
    ]);

    return {
      posts,
      total,
      page,
      limit,
      hasMore: skip + posts.length < total,
    };
  }

  async deletePost(orgId: string, group: string) {
    await this._post.model.post.updateMany({
      where: {
        organizationId: orgId,
        group,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    return this._post.model.post.findFirst({
      where: {
        organizationId: orgId,
        group,
        parentPostId: null,
      },
      select: {
        id: true,
      },
    });
  }

  async getPostsByGroup(orgId: string, group: string) {
    const posts = await this._post.model.post.findMany({
      where: {
        group,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      include: {
        integration: true,
        tags: {
          where: {
            tag: {
              deletedAt: null,
            },
          },
          select: {
            tag: true,
          },
        },
      },
    });
    return posts.map((post) => decryptIntegrationOf(post));
  }

  // the posts of the other channels in the batch, without the given group
  getPostsByBatch(orgId: string, batchId: string, exceptGroup: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        batchId,
        group: {
          not: exceptGroup,
        },
        deletedAt: null,
        integration: {
          deletedAt: null,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  // The organization is required, not optional: it is the tenant boundary, and
  // an optional security parameter is one a future caller forgets. A read that
  // deliberately crosses tenants passes PUBLIC_PREVIEW, so it says so at the
  // call site instead of omitting an argument.
  async getPost(
    id: string,
    includeIntegration = false,
    orgId: OrgScope,
    isFirst?: boolean
  ) {
    const post = await this._post.model.post.findUnique({
      where: {
        id,
        ...orgFilter(orgId),
        deletedAt: null,
      },
      include: {
        ...(includeIntegration
          ? {
              integration: true,
              tags: {
                where: {
                  tag: {
                    deletedAt: null,
                  },
                },
                select: {
                  tag: true,
                },
              },
            }
          : {}),
        childrenPost: true,
      },
    });
    return post ? decryptIntegrationOf(post) : post;
  }

  updatePost(id: string, postId: string, releaseURL: string, expectedIntegrationId?: string) {
    return this.updateActivePost(
      id,
      // a post published on a retry must not keep the earlier attempt's error
      { state: 'PUBLISHED', releaseURL, releaseId: postId, error: null },
      expectedIntegrationId ? { integrationId: expectedIntegrationId } : {}
    );
  }

  updateReleaseId(
    id: string,
    orgId: string,
    releaseId: string,
    releaseURL?: string,
    expectedIntegrationId?: string
  ) {
    return this.updateActivePost(
      id,
      {
        releaseId: String(releaseId),
        ...(releaseURL ? { releaseURL } : {}),
      },
      {
        organizationId: orgId,
        releaseId: 'missing',
        ...(expectedIntegrationId ? { integrationId: expectedIntegrationId } : {}),
      }
    );
  }

  updateResolvedRelease(
    id: string,
    orgId: string,
    releaseId: string,
    releaseURL: string,
    expectedIntegrationId?: string
  ) {
    return this.updateActivePost(
      id,
      { releaseId, releaseURL },
      {
        organizationId: orgId,
        ...(expectedIntegrationId ? { integrationId: expectedIntegrationId } : {}),
      }
    );
  }

  changeState(id: string, state: State, err?: any, body?: any) {
    return this.writeState(id, state, err, body);
  }

  async getErrorsByPostIds(postIds: string[]) {
    const errors = await this._errors.model.errors.findMany({
      where: {
        postId: { in: postIds },
      },
      select: {
        message: true,
        platform: true,
        body: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    // rows written before the allowlist can still hold whole post rows
    return errors.map((error) => ({
      ...error,
      body: auditErrorBody(error.body),
    }));
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    isDraft: boolean,
    action: 'schedule' | 'update' = 'schedule'
  ) {
    const data = {
      publishDate: dayjs(date).toDate(),
      // schedule: set state to QUEUE (or DRAFT if it was a draft), the
      // error and release of an earlier attempt no longer describe it
      // update: don't change the state
      ...(action === 'schedule'
        ? {
            state: isDraft ? ('DRAFT' as const) : ('QUEUE' as const),
            error: null,
            releaseId: null,
            releaseURL: null,
          }
        : {}),
    };
    return this._transaction.model.$transaction(async (tx) => {
      const updated = await tx.post.update({
        where: {
          organizationId: orgId,
          id,
        },
        data,
      });
      // the comments of a thread share the main post's date and state, like
      // createOrUpdatePost stores them
      await tx.post.updateMany({
        where: {
          organizationId: orgId,
          group: updated.group,
          integrationId: updated.integrationId,
          deletedAt: null,
          id: { not: id },
        },
        data,
      });
      return updated;
    });
  }

  // Moves a post and its comments to a state together, the comments of a
  // thread publish with the main post. Leaving ERROR clears its error; queued
  // again, the release of an earlier attempt is cleared too, like changeDate.
  // Without `republish` a post published since it was read is left alone.
  async changeGroupState(
    orgId: string,
    post: { group: string; integrationId: string },
    state: 'DRAFT' | 'QUEUE',
    republish = false
  ) {
    const changed = await this._post.model.post.updateMany({
      where: {
        organizationId: orgId,
        group: post.group,
        integrationId: post.integrationId,
        deletedAt: null,
        integration: { deletedAt: null },
        ...(republish ? {} : { state: { not: 'PUBLISHED' as const } }),
      },
      data: {
        state,
        error: null,
        ...(state === 'QUEUE' ? { releaseId: null, releaseURL: null } : {}),
      },
    });
    if (!changed.count) {
      throw new BadRequestException('Post is no longer available.');
    }
    return changed;
  }

  countPostsFromDay(orgId: string, date: Date) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: date,
        },
        OR: [
          {
            deletedAt: null,
            state: {
              in: ['QUEUE'],
            },
          },
          {
            state: 'PUBLISHED',
          },
        ],
      },
    });
  }

  // Posts published to one network in a plan month, what its cap counts
  countProviderUsage(
    orgId: string,
    providerIdentifier: string,
    from: Date,
    until: Date
  ) {
    return this._providerPostUsage.model.providerPostUsage.count({
      where: {
        organizationId: orgId,
        providerIdentifier,
        createdAt: {
          gte: from,
          lt: until,
        },
      },
    });
  }

  recordProviderUsage(
    orgId: string,
    providerIdentifier: string,
    postIds: string[]
  ) {
    return this._providerPostUsage.model.providerPostUsage.createMany({
      data: postIds.map((postId) => ({
        organizationId: orgId,
        providerIdentifier,
        postId,
      })),
    });
  }

  // Posts waiting to publish to one network in a plan month, leaving out the
  // posts that are being saved again
  countQueuedProviderPosts(
    orgId: string,
    providerIdentifier: string,
    from: Date,
    until: Date,
    excludeIds: string[] = []
  ) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        state: 'QUEUE',
        integration: {
          providerIdentifier,
          deletedAt: null,
        },
        publishDate: {
          gte: from,
          lt: until,
        },
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      },
    });
  }

  // Publish dates of one connected account's posts (a network account can be
  // connected in several workspaces), what a provider's postingLimits count:
  // the published posts and, with includeQueued, the queued ones. Comments
  // are not counted, a post deleted after it went out still is
  async getAccountPostingDates(
    providerIdentifier: string,
    internalId: string,
    from: Date,
    until: Date,
    includeQueued: boolean,
    excludeIds: string[] = []
  ) {
    return (
      await this._post.model.post.findMany({
        where: {
          parentPostId: null,
          publishDate: {
            gte: from,
            lt: until,
          },
          integration: {
            providerIdentifier,
            internalId,
          },
          OR: [
            { state: 'PUBLISHED' },
            ...(includeQueued
              ? [{ state: 'QUEUE' as const, deletedAt: null }]
              : []),
          ],
          ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
        },
        select: {
          publishDate: true,
        },
        orderBy: {
          publishDate: 'asc',
        },
      })
    ).map((post) => post.publishDate);
  }

  getPostsState(orgId: string, ids: string[]) {
    if (!ids.length) {
      return Promise.resolve([]);
    }
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        id: { in: ids },
      },
      select: {
        id: true,
        state: true,
        publishDate: true,
        deletedAt: true,
      },
    });
  }

  async createOrUpdatePost(
    state: 'draft' | 'schedule' | 'now' | 'update',
    orgId: string,
    date: string,
    body: PostBody,
    tags: { value: string; label: string }[],
    creationMethod: CreationMethod,
    inter?: number,
    // Keep the existing group instead of rotating it, so open clients
    // (calendar) holding the group stay valid. Used by out-of-band updates
    // (agent / MCP / public API); the dashboard keeps the rotate-and-sweep.
    keepGroup = false,
    // Shared by the posts saved together for several channels, so opening one
    // of them in the editor brings the others.
    batchId?: string,
    // the review state to store (undefined keeps it) and, on create, the
    // agent that created the post
    approval: { approvalStatus?: ApprovalStatus; agentSource?: string } = {}
  ) {
    const posts: Post[] = [];
    const uuid = uuidv4();
    // keepGroup reuses the client-supplied group only when it already belongs
    // to this organization, so a foreign group id can never be adopted
    const ownsGroup =
      keepGroup && body.group
        ? !!(await this._post.model.post.findFirst({
            where: {
              group: body.group,
              organizationId: orgId,
            },
            select: {
              id: true,
            },
          }))
        : false;
    const group = ownsGroup ? body.group : uuid;

    // an edited post stays in the batch it was created in, even when it is
    // saved on its own or with a group that was rotated since
    const ids = body.value.map((value) => value.id).filter(Boolean);
    const existingBatchId =
      body.group || ids.length
        ? (
            await this._post.model.post.findFirst({
              where: {
                organizationId: orgId,
                deletedAt: null,
                batchId: {
                  not: null,
                },
                OR: [
                  ...(body.group ? [{ group: body.group }] : []),
                  ...(ids.length ? [{ id: { in: ids } }] : []),
                ],
              },
              select: {
                batchId: true,
              },
            })
          )?.batchId
        : undefined;

    for (const value of body.value) {
      const updateData = (type: 'create' | 'update') => ({
        publishDate: dayjs(date).toDate(),
        integration: {
          connect: {
            id: body.integration.id,
            organizationId: orgId,
          },
        },
        ...(posts?.[posts.length - 1]?.id
          ? {
              parentPost: {
                connect: {
                  id: posts[posts.length - 1]?.id,
                },
              },
            }
          : type === 'update'
          ? {
              parentPost: {
                disconnect: true,
              },
            }
          : {}),
        content: value.content,
        delay: value.delay || 0,
        group,
        batchId: existingBatchId || batchId,
        intervalInDays: inter ? +inter : null,
        approvedSubmitForOrder: APPROVED_SUBMIT_FOR_ORDER.NO,
        ...(type === 'create' ? { creationMethod } : {}),
        ...(approval.approvalStatus
          ? { approvalStatus: approval.approvalStatus }
          : {}),
        ...(type === 'create' && approval.agentSource
          ? { agentSource: approval.agentSource }
          : {}),
        ...(state === 'update'
          ? {}
          : {
              state:
                state === 'draft' ? ('DRAFT' as const) : ('QUEUE' as const),
              // no longer failed: the error of an earlier attempt goes
              error: null,
              // queued again: so does the release of an earlier publish,
              // like changeDate on a reschedule
              ...(state === 'draft'
                ? {}
                : { releaseId: null, releaseURL: null }),
            }),
        image: JSON.stringify(value.image),
        settings: JSON.stringify(body.settings),
        organization: {
          connect: {
            id: orgId,
          },
        },
      });

      posts.push(
        await this._post.model.post.upsert({
          where: {
            id: value.id || uuidv4(),
            organizationId: orgId,
            integrationId: body.integration.id,
          },
          create: { ...updateData('create') },
          update: {
            ...updateData('update'),
            lastMessage: {
              disconnect: true,
            },
            submittedForOrder: {
              disconnect: true,
            },
          },
        })
      );

      if (posts.length === 1) {
        await this._tagsPosts.model.tagsPosts.deleteMany({
          where: {
            post: {
              id: posts[0].id,
            },
          },
        });

        if (tags.length) {
          const tagsList = await this._tags.model.tags.findMany({
            where: {
              orgId: orgId,
              deletedAt: null,
              name: {
                in: tags.map((tag) => tag.label).filter((f) => f),
              },
            },
          });

          if (tagsList.length) {
            await this._post.model.post.update({
              where: {
                id: posts[posts.length - 1].id,
              },
              data: {
                tags: {
                  createMany: {
                    data: tagsList.map((tag) => ({
                      tagId: tag.id,
                    })),
                  },
                },
              },
            });
          }
        }
      }
    }

    const previousPost = body.group
      ? (
          await this._post.model.post.findFirst({
            where: {
              group: body.group,
              organizationId: orgId,
              deletedAt: null,
              parentPostId: null,
            },
            select: {
              id: true,
            },
          })
        )?.id!
      : undefined;

    if (body.group && !keepGroup) {
      await this._post.model.post.updateMany({
        where: {
          group: body.group,
          organizationId: orgId,
          deletedAt: null,
        },
        data: {
          parentPostId: null,
          deletedAt: new Date(),
        },
      });
    }

    // keepGroup: the updated rows still carry the old group, so sweep only the
    // rows dropped from it (removed comments) by id instead of by group.
    if (body.group && keepGroup) {
      await this._post.model.post.updateMany({
        where: {
          group: body.group,
          organizationId: orgId,
          deletedAt: null,
          id: {
            notIn: posts.map((p) => p.id),
          },
        },
        data: {
          parentPostId: null,
          deletedAt: new Date(),
        },
      });
    }

    return { previousPost, posts };
  }

  // Keeps a post and its comments as a draft until an approver approves it.
  // A failed post held this way is no longer failed, its old error goes.
  holdForReview(orgId: string, group: string) {
    return this._post.model.post.updateMany({
      where: { organizationId: orgId, group, deletedAt: null },
      data: { state: 'DRAFT', approvalStatus: 'IN_REVIEW', error: null },
    });
  }

  async submit(id: string, order: string, buyerOrganizationId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        submittedForOrderId: order,
        approvedSubmitForOrder: 'WAITING_CONFIRMATION',
        submittedForOrganizationId: buyerOrganizationId,
      },
      select: {
        id: true,
        description: true,
        submittedForOrder: {
          select: {
            messageGroupId: true,
          },
        },
      },
    });
  }

  updateMessage(id: string, messageId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        lastMessageId: messageId,
      },
    });
  }

  // The organization is required: see getPost above.
  async getPostById(id: string, org: OrgScope) {
    const post = await this._post.model.post.findUnique({
      where: {
        id,
        ...orgFilter(org),
      },
      include: {
        integration: true,
        submittedForOrder: {
          include: {
            posts: {
              where: {
                state: 'PUBLISHED',
              },
            },
            ordersItems: true,
            seller: {
              select: {
                id: true,
                account: true,
              },
            },
          },
        },
      },
    });
    return post ? decryptIntegrationOf(post) : post;
  }

  private get postTimelineSelect() {
    return {
      id: true,
      state: true,
      publishDate: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      releaseId: true,
      releaseURL: true,
      error: true,
      creationMethod: true,
      group: true,
      parentPostId: true,
    } as const;
  }

  async getPostTimeline(id: string, org: string) {
    const timeline = await this._post.model.post.findFirst({
      where: {
        id,
        organizationId: org,
      },
      select: {
        ...this.postTimelineSelect,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            disabled: true,
            refreshNeeded: true,
            deletedAt: true,
          },
        },
        childrenPost: {
          select: this.postTimelineSelect,
          orderBy: { publishDate: 'asc' as const },
        },
        errors: {
          select: {
            id: true,
            platform: true,
            message: true,
            body: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' as const },
        },
      },
    });
    if (!timeline) {
      return timeline;
    }
    // rows written before the allowlist can still hold whole post rows
    return {
      ...timeline,
      errors: timeline.errors.map((error) => ({
        ...error,
        body: auditErrorBody(error.body),
      })),
    };
  }

  findAllExistingCategories() {
    return this._popularPosts.model.popularPosts.findMany({
      select: {
        category: true,
      },
      distinct: ['category'],
    });
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
      },
      select: {
        topic: true,
      },
      distinct: ['topic'],
    });
  }

  findPopularPosts(category: string, topic?: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
        ...(topic ? { topic } : {}),
      },
      select: {
        content: true,
        hook: true,
      },
    });
  }

  createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._popularPosts.model.popularPosts.create({
      data: {
        category: 'category',
        topic: 'topic',
        content: 'content',
        hook: 'hook',
      },
    });
  }

  async getPostsCountsByDates(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs
  ) {
    const dates = await this._post.model.post.findMany({
      where: {
        deletedAt: null,
        organizationId: orgId,
        publishDate: {
          in: times.map((time) => {
            return date.clone().add(time, 'minutes').toDate();
          }),
        },
      },
    });

    return times.filter(
      (time) =>
        date.clone().add(time, 'minutes').isAfter(dayjs.utc()) &&
        !dates.find((dateFind) => {
          return (
            dayjs
              .utc(dateFind.publishDate)
              .diff(date.clone().startOf('day'), 'minutes') == time
          );
        })
    );
  }

  // the dates channels already post at, so a bulk schedule skips the time
  // slots that have a post
  getPublishDatesOfIntegrations(
    orgId: string,
    integrationIds: string[],
    from: Date,
    until: Date
  ) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        parentPostId: null,
        integrationId: { in: integrationIds },
        publishDate: { gte: from, lt: until },
      },
      select: {
        integrationId: true,
        publishDate: true,
      },
    });
  }

  getCommentsForPosts(postIds: string[]) {
    return this._comments.model.comments.findMany({
      where: {
        postId: {
          in: postIds,
        },
        deletedAt: null,
      },
      include: {
        user: {
          select: {
            name: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  getCommentById(id: string) {
    return this._comments.model.comments.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        post: {
          select: {
            id: true,
            organizationId: true,
          },
        },
      },
    });
  }

  setCommentResolved(id: string, resolvedAt: Date | null) {
    return this._comments.model.comments.update({
      where: {
        id,
      },
      data: {
        resolvedAt,
      },
    });
  }

  getAnchoredCommentsForPost(postId: string) {
    return this._comments.model.comments.findMany({
      where: {
        postId,
        deletedAt: null,
        anchorStart: {
          not: null,
        },
      },
    });
  }

  detachAnchorsForPost(postId: string, ids: string[]) {
    return this._comments.model.comments.updateMany({
      where: {
        postId,
        id: {
          in: ids,
        },
      },
      data: {
        anchorStart: null,
        anchorEnd: null,
      },
    });
  }

  async getTags(orgId: string) {
    return this._tags.model.tags.findMany({
      where: {
        orgId,
        deletedAt: null,
      },
    });
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.create({
      data: {
        orgId,
        name: body.name,
        color: body.color,
        ...(body.kind ? { kind: body.kind } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
      },
    });
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.update({
      where: {
        id,
        orgId,
      },
      data: {
        name: body.name,
        color: body.color,
        ...(body.kind ? { kind: body.kind } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
      },
    });
  }

  async deleteTag(id: string, orgId: string) {
    const tag = await this._tags.model.tags.update({
      where: {
        id,
        orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    await this._tagsPosts.model.tagsPosts.deleteMany({
      where: {
        tagId: tag.id,
      },
    });

    return tag;
  }

  createComment(
    orgId: string,
    userId: string | null,
    postId: string,
    content: string,
    extra: {
      displayName?: string;
      parentId?: string;
      anchorStart?: number;
      anchorEnd?: number;
      anchorQuote?: string;
    } = {}
  ) {
    return this._comments.model.comments.create({
      data: {
        organizationId: orgId,
        userId,
        postId,
        content,
        displayName: extra.displayName ?? null,
        parentId: extra.parentId ?? null,
        anchorStart: extra.anchorStart ?? null,
        anchorEnd: extra.anchorEnd ?? null,
        anchorQuote: extra.anchorQuote ?? null,
      },
    });
  }

  async getPostByForWebhookId(postId: string, integrationId: string) {
    const select = {
      id: true,
      content: true,
      publishDate: true,
      releaseURL: true,
      state: true,
      integration: {
        select: {
          id: true,
          name: true,
          providerIdentifier: true,
          picture: true,
          type: true,
        },
      },
    };

    const posts = await this._post.model.post.findMany({
      where: {
        id: postId,
        deletedAt: null,
        parentPostId: null,
      },
      select,
    });

    if (posts.length) {
      return posts;
    }

    // The running workflows pass the platform's post id, which updatePost
    // already stored on the row as releaseId before the webhook is sent.
    return this._post.model.post.findMany({
      where: {
        releaseId: postId,
        integrationId,
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: {
        updatedAt: 'desc' as const,
      },
      take: 1,
      select,
    });
  }

  async getPostsSince(orgId: string, since: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: new Date(since),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  // Like changeState, but only while the post is still in one of the expected
  // states: the state check and the write are one conditional updateMany (see
  // updateActivePost), so a run racing another writer - the user, the
  // missing-posts sweep, another run - can never overwrite what that one
  // recorded. A post that is gone or no longer in those states is not a
  // failure, there is just nothing to write: it returns null.
  // A retried activity whose earlier attempt committed but never reported
  // finds the row already in the target state with the same error: that is
  // this write, so it reports it as written (without writing again).
  async changeStateIf(
    id: string,
    expectedStates: State[],
    state: State,
    err?: any,
    body?: any,
    release?: { releaseId: string; releaseURL?: string }
  ) {
    try {
      return await this.writeState(
        id,
        state,
        err,
        body,
        { state: { in: expectedStates } },
        release
      );
    } catch (e) {
      if (!(e instanceof BadRequestException)) {
        throw e;
      }

      return this._post.model.post.findFirst({
        where: {
          id,
          state,
          ...(err
            ? { error: typeof err === 'string' ? err : JSON.stringify(err) }
            : {}),
          deletedAt: null,
          integration: { deletedAt: null },
        },
        select: { id: true },
      });
    }
  }

  private async writeState(
    id: string,
    state: State,
    err?: any,
    body?: any,
    conditions: Prisma.PostWhereInput = {},
    release?: { releaseId: string; releaseURL?: string }
  ) {
    const updated = await this.updateActivePost(
      id,
      {
        state,
        ...(err
          ? { error: typeof err === 'string' ? err : JSON.stringify(err) }
          : // queued again or back to draft: the last failure no longer applies
          state === 'QUEUE' || state === 'DRAFT'
          ? { error: null }
          : {}),
        // a post that went out and then failed keeps where it went out
        ...(release
          ? {
              releaseId: String(release.releaseId),
              ...(release.releaseURL ? { releaseURL: release.releaseURL } : {}),
            }
          : {}),
      },
      conditions,
      true
    );
    if (state === 'ERROR' && err && body) {
      try {
        // Audit logging remains best-effort, but this second transaction must
        // lock and recheck the original channel/post before retaining payloads.
        await this.updateActivePost(
          id,
          { deletedAt: null },
          { integrationId: updated!.integrationId },
          true,
          {
            message: typeof err === 'string' ? err : JSON.stringify(err),
            body: auditErrorBody(body),
          }
        );
      } catch {
        // The state transition committed independently of audit availability.
      }
    }
    return updated;
  }
}
