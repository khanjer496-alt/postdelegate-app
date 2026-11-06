import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import { PostsEvergreenRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.evergreen.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { plainTextToHtml } from '@gitroom/helpers/utils/plain.text.to.html';
import { EvergreenDto } from '@gitroom/nestjs-libraries/dtos/posts/evergreen.dto';
import {
  evergreenSharesDone,
  evergreenUpcoming,
  parseEvergreenVariants,
} from '@gitroom/nestjs-libraries/database/prisma/posts/posts.evergreen.schedule';

type Root = Awaited<
  ReturnType<PostsEvergreenRepository['getGroupRoots']>
>[number];

// A repeating post whose chain of shares is over: the publish workflow
// stops after a failure, and after the last share the limits allow
const chainEnded = (root: Root, now = Date.now()) =>
  root.state === 'ERROR' ||
  (root.state === 'PUBLISHED' &&
    !!root.intervalInDays &&
    !evergreenUpcoming(root.publishDate, root, now, 1).length);

@Injectable()
export class PostsEvergreenService {
  private readonly _logger = new Logger(PostsEvergreenService.name);
  constructor(
    private _evergreenRepository: PostsEvergreenRepository,
    private _temporalService: TemporalService,
    private _postsService: PostsService
  ) {}

  private async roots(orgId: string, group: string) {
    const roots = await this._evergreenRepository.getGroupRoots(orgId, group);
    if (!roots.length) {
      throw new NotFoundException('Post not found');
    }
    return roots;
  }

  private summary(roots: Root[]) {
    const [first] = roots;
    const now = Date.now();
    const finished = roots.some((root) => chainEnded(root, now));
    return {
      enabled: !!first.intervalInDays && !finished,
      // nothing more will be shared, editing can't bring it back
      finished,
      intervalInDays: first.intervalInDays,
      maxShares: first.evergreenMaxShares,
      until: first.evergreenUntil,
      variants: parseEvergreenVariants(first.evergreenVariants),
      published: roots.some((root) => root.state === 'PUBLISHED'),
      sharesDone: evergreenSharesDone(first.publishDate, first, now),
      upcoming: finished
        ? []
        : evergreenUpcoming(first.publishDate, first, now, 5),
      channels: roots.map((root) => ({
        id: root.integration.id,
        name: root.integration.name,
        identifier: root.integration.providerIdentifier,
        state: root.state,
      })),
    };
  }

  async getEvergreen(orgId: string, group: string) {
    return { ...this.summary(await this.roots(orgId, group)), group };
  }

  async updateEvergreen(orgId: string, group: string, body: EvergreenDto) {
    const roots = await this.roots(orgId, group);
    const published = roots.filter((root) => root.state === 'PUBLISHED');

    if (roots.some((root) => root.state === 'ERROR')) {
      throw new BadRequestException(
        'This post failed to publish. Fix it and schedule it again before making it evergreen.'
      );
    }

    // no workflow waits for a next share any more, new limits would only
    // show shares on the calendar that never go out
    if (published.some((root) => chainEnded(root))) {
      throw new BadRequestException(
        'This post finished re-sharing. Duplicate it to share it on a new schedule.'
      );
    }

    if (published.some((root) => !root.intervalInDays)) {
      throw new BadRequestException(
        'This post was already published, so it can no longer become evergreen. Duplicate it and make the copy evergreen instead.'
      );
    }

    // a sleeping workflow already waits for the next share with the old
    // interval, so the share dates would drift
    if (
      published.some((root) => root.intervalInDays !== body.intervalInDays)
    ) {
      throw new BadRequestException(
        'The repeat interval cannot change after the first share. Stop evergreen and duplicate the post to start a new schedule.'
      );
    }

    // every share is a post the plan can't count on a network it caps a month
    await this._postsService.checkRepeatAllowed(
      orgId,
      roots.map((root) => root.integration.id)
    );

    const until = body.until ? new Date(body.until) : null;
    if (until && until.getTime() <= Date.now()) {
      throw new BadRequestException('Pick an end date in the future.');
    }

    const variants = (body.variants || [])
      .map((variant) => variant.trim())
      .filter(Boolean);
    await this.checkVariants(orgId, roots, variants);

    await this._evergreenRepository.updateGroupRoots(orgId, group, {
      intervalInDays: body.intervalInDays,
      evergreenMaxShares: body.maxShares ?? null,
      evergreenUntil: until,
      evergreenVariants: variants.length ? JSON.stringify(variants) : null,
    });

    const updated = await this.roots(orgId, group);
    // the new limits leave nothing to share: the workflow waiting for the
    // next share is stopped, otherwise it would share once more
    for (const root of updated) {
      if (
        root.state === 'PUBLISHED' &&
        !evergreenUpcoming(root.publishDate, root, Date.now(), 1).length
      ) {
        await this.stopWorkflows(root.id);
      }
    }

    return { ...this.summary(updated), group };
  }

  // A post that was not published yet simply loses its schedule: the publish
  // workflow reads the interval when it publishes. A published one keeps its
  // past shares on the calendar (ending now) and its waiting workflow stops.
  async stopEvergreen(orgId: string, group: string) {
    const roots = await this.roots(orgId, group);
    const published = roots.some(
      (root) => root.state === 'PUBLISHED' && root.intervalInDays
    );

    await this._evergreenRepository.updateGroupRoots(
      orgId,
      group,
      published
        ? {
            intervalInDays: roots[0].intervalInDays,
            evergreenMaxShares: roots[0].evergreenMaxShares,
            evergreenUntil: new Date(),
            evergreenVariants: roots[0].evergreenVariants,
          }
        : {
            intervalInDays: null,
            evergreenMaxShares: null,
            evergreenUntil: null,
            evergreenVariants: null,
          }
    );

    for (const root of roots) {
      if (root.state === 'PUBLISHED' && root.intervalInDays) {
        await this.stopWorkflows(root.id);
      }
    }

    return { ...this.summary(await this.roots(orgId, group)), group };
  }

  // each wording must fit every channel of the post, like the original text
  private async checkVariants(orgId: string, roots: Root[], variants: string[]) {
    for (const [index, variant] of variants.entries()) {
      const results = await this._postsService.validatePosts(
        orgId,
        roots.map((root) => {
          let settings = {};
          try {
            settings = JSON.parse(root.settings || '{}');
          } catch (err) {
            settings = {};
          }
          return {
            integration: { id: root.integration.id },
            value: [{ content: plainTextToHtml(variant), image: [] }],
            settings,
          };
        })
      );
      const tooLong = results.find((result) => result.tooLong);
      if (tooLong) {
        throw new BadRequestException(
          `Wording ${index + 1} is longer than ${tooLong.maximumCharacters} characters, the limit of ${tooLong.name}.`
        );
      }
    }
  }

  private async stopWorkflows(postId: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (await this.terminateWorkflows(postId)) {
        return;
      }
    }
    this._logger.warn(
      `Could not stop the evergreen workflow of post ${postId}, its next share may still go out.`
    );
  }

  // same lookup as PostsService.startWorkflow / deletePost, true when every
  // running workflow of the post was stopped
  private async terminateWorkflows(postId: string) {
    let stopped = true;
    try {
      const workflows = this._temporalService.client
        .getRawClient()
        ?.workflow.list({
          query: `postId="${postId}" AND ExecutionStatus="Running"`,
        });

      for await (const executionInfo of workflows) {
        try {
          const workflow = await this._temporalService.client.getWorkflowHandle(
            executionInfo.workflowId
          );
          if (
            workflow &&
            (await workflow.describe()).status.name !== 'TERMINATED'
          ) {
            await workflow.terminate();
          }
        } catch (err) {
          stopped = false;
        }
      }
    } catch (err) {
      stopped = false;
    }
    return stopped;
  }
}
