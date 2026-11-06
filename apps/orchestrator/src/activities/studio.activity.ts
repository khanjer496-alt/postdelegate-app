import { Injectable, OnModuleInit } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { Context } from '@temporalio/activity';
import { CancelledFailure } from '@temporalio/common';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { StudioAiService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.ai.service';
import {
  setHeartbeatDetails,
  withHeartbeat,
} from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';

// An activity can never change its parameters, so every one takes a single
// object of ids: the state lives on the render record, and a field can be
// added to the object without a new activity
@Injectable()
@Activity()
export class StudioActivity implements OnModuleInit {
  constructor(
    private _studioService: StudioService,
    private _studioAiService: StudioAiService
  ) {}

  // folders a worker that crashed mid render left behind
  async onModuleInit() {
    await this._studioService.sweepTmp();
  }

  @ActivityMethod()
  async prepareStudioRenderV1({ renderId }: { renderId: string }) {
    return this._studioService.prepareRender(renderId);
  }

  // Runs on the "studio" queue only, whose concurrency is the number of
  // renders this server runs at once. Every progress tick heartbeats, which
  // is also how a cancel reaches the running ffmpeg
  @ActivityMethod()
  async renderStudioV1({ renderId }: { renderId: string }) {
    const context = Context.current();
    return withHeartbeat(async () => {
      try {
        await this._studioService.render(renderId, {
          signal: context.cancellationSignal,
          heartbeat: (details) => {
            setHeartbeatDetails(`renderStudioV1: ${details}`);
            context.heartbeat(details);
          },
        });
      } catch (err) {
        if (context.cancellationSignal.aborted) {
          throw new CancelledFailure('The render was cancelled');
        }
        throw err;
      }
    });
  }

  // What the template asks the workspace's own AI for (a voice, stills), made
  // before the render on the main queue: it waits on the AI, not on the CPU,
  // so it never holds a render slot. Heartbeats carry a cancel to the calls
  @ActivityMethod()
  async prepareStudioAiV1({ renderId }: { renderId: string }) {
    const context = Context.current();
    return withHeartbeat(async () => {
      try {
        setHeartbeatDetails('prepareStudioAiV1: generating');
        await this._studioAiService.generateForRender(
          renderId,
          context.cancellationSignal
        );
      } catch (err) {
        if (context.cancellationSignal.aborted) {
          throw new CancelledFailure('The render was cancelled');
        }
        throw err;
      }
    });
  }

  @ActivityMethod()
  async finishStudioRenderV1({ renderId }: { renderId: string }) {
    return this._studioService.finishRender(renderId);
  }

  // "customer" says the error was written for the customer to read
  @ActivityMethod()
  async failStudioRenderV1({
    renderId,
    error,
    customer,
    cancelled,
  }: {
    renderId: string;
    error: string;
    customer?: boolean;
    cancelled?: boolean;
  }) {
    return this._studioService.failRender(renderId, error, customer, cancelled);
  }

  // The daily cleanup of studioCleanupWorkflowV1: stored music of deleted
  // projects and music unused for a week, and render records older than 90
  // days. STUDIO_CLEANUP_DISABLED=true switches it off, and the workflow then
  // ends. Takes an empty object so fields can be added later
  @ActivityMethod()
  async cleanupStudioV1(_args: Record<string, never> = {}) {
    if (process.env.STUDIO_CLEANUP_DISABLED === 'true') {
      return { enabled: false, assets: 0, renders: 0 };
    }
    const context = Context.current();
    const removed = await withHeartbeat(() =>
      this._studioService.cleanup((details) => {
        setHeartbeatDetails(`cleanupStudioV1: ${details}`);
        context.heartbeat(details);
      })
    );
    return { enabled: true, ...removed };
  }
}
