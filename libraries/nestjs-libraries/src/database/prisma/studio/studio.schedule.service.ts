import { BadRequestException, Injectable } from '@nestjs/common';
import { uniq } from 'lodash';
import dayjs from 'dayjs';
import { StudioRepository } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.repository';
import { PostsBulkVideosService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.bulk.videos.service';
import { ApprovalActor } from '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service';
import { BulkVideoPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/bulk.videos.dto';
import { StudioScheduleRendersDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.schedule.dto';

// Finished Studio videos go to the calendar through the bulk video upload,
// so they pass exactly the checks every other bulk post does
@Injectable()
export class StudioScheduleService {
  constructor(
    private _studioRepository: StudioRepository,
    private _postsBulkVideosService: PostsBulkVideosService
  ) {}

  // The bulk video request of the renders: one video each, in the order they
  // were picked, in the free time slots of every channel from today. The
  // same renders, channels and text make the same request all day long
  private async request(
    org: string,
    body: StudioScheduleRendersDto
  ): Promise<BulkVideoPostsDto> {
    const ids = uniq(body.renderIds);
    const renders = await this._studioRepository.getRendersToSchedule(
      org,
      ids
    );
    if (renders.length !== ids.length) {
      throw new BadRequestException(
        'Only finished videos of this workspace can be scheduled. Pick them again.'
      );
    }

    const byId = new Map(renders.map((render) => [render.id, render]));
    return {
      type: body.type || 'schedule',
      schedule: {
        mode: 'slots',
        start: dayjs().startOf('day').toISOString(),
      },
      caption: body.content || '',
      channels: body.integrations,
      videos: ids.map((id) => ({ mediaId: byId.get(id)!.mediaId! })),
    };
  }

  // Where the same request stands: never sent, running, or done
  async status(org: string, body: StudioScheduleRendersDto) {
    return this._postsBulkVideosService.status(
      org,
      await this.request(org, body)
    );
  }

  // One post a video on every channel, each in the next free time slot of
  // the channel, through every check of POST /posts. "remaining" is what the
  // plan still allows this month (null for no limit), "actor" the member
  // scheduling (approvals apply). Sending the same renders, channels and
  // text again the same day returns the first result instead of posting twice
  async scheduleRenders(
    org: string,
    body: StudioScheduleRendersDto,
    remaining: number | null,
    actor?: ApprovalActor
  ) {
    const request = await this.request(org, body);
    // a request sent before gets its result (or its 409 while it runs)
    if (
      (await this._postsBulkVideosService.status(org, request)).status !==
      'none'
    ) {
      return this._postsBulkVideosService.create(
        org,
        request,
        remaining,
        actor
      );
    }

    // the problems of every video in one message, before anything is created
    const preview = await this._postsBulkVideosService.preview(
      org,
      request,
      remaining
    );
    if (preview.invalid) {
      throw new BadRequestException(
        preview.posts.flatMap((post, index) =>
          [
            ...post.errors,
            ...post.channels.flatMap((channel) =>
              channel.errors.map((error) => ({
                ...error,
                message: `${channel.name}: ${error.message}`,
              }))
            ),
          ].map((error) => `Video ${index + 1}: ${error.message}`)
        )
      );
    }

    return this._postsBulkVideosService.create(
      org,
      request,
      remaining,
      actor
    );
  }
}
