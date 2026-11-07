import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { HttpException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class StudioRenderStatusTool implements AgentToolInterface {
  constructor(private _studioService: StudioService) {}
  name = 'studioRenderStatusTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'studioRenderStatusTool',
      mcp: {
        annotations: {
          title: 'Studio Render Status',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `Check a render started with 'studioRenderTool', using the renderId it returned.
                    While the render waits or runs, this call waits up to 25 seconds for it to finish before it answers, so there is no need to wait between two calls:
                    when the status is still "pending" call it again, and after a few calls tell the user it is still rendering and check again when they ask.
                    When the status is "completed" the video is in the media library: the result has its mediaId and path.
                    To post it, use the path as an attachment of 'integrationSchedulePostTool', following the usual rules: draft by default, and the user's OK before scheduling. Approvals of the workspace still apply.
                    When the status is "failed" the result contains the reason and the video was not counted. "cancelled" means it was stopped.
      `,
      inputSchema: z.object({
        renderId: z
          .string()
          .describe('The renderId returned by studioRenderTool'),
      }),
      outputSchema: z.object({
        status: z
          .enum(['pending', 'completed', 'failed', 'cancelled'])
          .optional(),
        step: z.string().optional(),
        progress: z.number().optional(),
        seconds: z.number().optional(),
        mediaId: z.string().optional(),
        path: z.string().optional(),
        thumbnail: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );
        try {
          const render = await this._studioService.waitForRender(
            org.id,
            inputData.renderId,
            25
          );

          return {
            status: ['completed', 'failed', 'cancelled'].includes(
              render.status
            )
              ? (render.status as 'completed' | 'failed' | 'cancelled')
              : ('pending' as const),
            step: render.status,
            progress: render.progress,
            seconds: render.seconds,
            mediaId: render.mediaId || undefined,
            path: render.path || undefined,
            thumbnail: render.thumbnail || undefined,
            error: render.error || undefined,
          };
        } catch (err) {
          if (!(err instanceof HttpException)) {
            console.error('studioRenderStatusTool failed:', err);
          }
          const message =
            err instanceof HttpException ? err.message : 'Something went wrong';
          return {
            error: `Studio render lookup failed: ${message}`,
          };
        }
      },
    });
  }
}
