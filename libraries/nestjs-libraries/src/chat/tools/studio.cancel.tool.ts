import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { HttpException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class StudioCancelTool implements AgentToolInterface {
  constructor(private _studioService: StudioService) {}
  name = 'studioCancelTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'studioCancelTool',
      mcp: {
        annotations: {
          title: 'Cancel a Studio Render',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `Stop a render started with 'studioRenderTool' that is still waiting or rendering, using its renderId.
                    Only cancel when the user asked for it. A cancelled render cannot be resumed and still counts toward the daily and trial limits: render again to get the video.
                    A render that already finished is left as it is, and its video stays in the media library.
      `,
      inputSchema: z.object({
        renderId: z
          .string()
          .describe('The renderId returned by studioRenderTool'),
      }),
      outputSchema: z.object({
        status: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );
        try {
          const render = await this._studioService.cancelRender(
            org.id,
            inputData.renderId
          );

          return {
            status: render.status,
          };
        } catch (err) {
          if (!(err instanceof HttpException)) {
            console.error('studioCancelTool failed:', err);
          }
          const message =
            err instanceof HttpException ? err.message : 'Something went wrong';
          return {
            error: `The render could not be cancelled: ${message}`,
          };
        }
      },
    });
  }
}
