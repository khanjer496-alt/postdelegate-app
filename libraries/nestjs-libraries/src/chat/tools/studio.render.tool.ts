import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { HttpException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

// Only what was written for the customer goes to the model: a database or
// provider error carries paths, queries and urls. A spec that fails its
// template's validation carries every message as a list
const readableError = (err: unknown) => {
  if (!(err instanceof HttpException)) {
    console.error('studioRenderTool failed:', err);
    return 'Something went wrong';
  }

  const response = err.getResponse() as string | { message?: unknown };
  const message =
    typeof response === 'string' ? response : response?.message;
  return Array.isArray(message)
    ? message.join('; ')
    : typeof message === 'string'
    ? message
    : err.message;
};

@Injectable()
export class StudioRenderTool implements AgentToolInterface {
  constructor(private _studioService: StudioService) {}
  name = 'studioRenderTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'studioRenderTool',
      mcp: {
        annotations: {
          title: 'Render a Studio Video',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `Render a vertical 1080x1920 video with a Studio template, from videos already in the media library.
                    Call 'studioTemplatesTool' first and build the spec from the schema of the chosen template.
                    Media are only the "mediaId" of media in this workspace's media library (from 'mediaListTool', or 'uploadFromUrlTool' for a public file). Urls are never accepted.
                    Rendering only saves a new video to the media library: it never creates, schedules or publishes a post.
                    Before calling this tool, tell the user which video, template, trim and text you will use, and get their OK.
                    Studio has fair use limits: one video renders at a time per workspace and up to 3 more can wait, 30 videos a day, 90 seconds per video, and 10 videos in total during the trial. It needs an active plan.
                    This only starts the render and returns a renderId: tell the user it is rendering, then call 'studioRenderStatusTool' with the renderId to wait for the video.
                    When it fails to start, the result contains the reason (for example Studio is busy, the daily limit is reached or a plan is needed): tell the user, nothing was counted.
      `,
      inputSchema: z.object({
        template: z
          .string()
          .describe('The identifier of a template from studioTemplatesTool'),
        spec: z
          .record(z.string(), z.any())
          .describe(
            'The inputs of the template, following its schema from studioTemplatesTool. Media are media ids of the media library, never urls'
          ),
        name: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe(
            'Name of the project in Studio, the title of the template by default'
          ),
      }),
      outputSchema: z.object({
        renderId: z.string().optional(),
        projectId: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );
        try {
          const render = await this._studioService.renderFromSpec(org, {
            template: inputData.template,
            spec: inputData.spec,
            name: inputData.name,
          });

          return {
            renderId: render.id,
            projectId: render.projectId,
          };
        } catch (err) {
          return {
            error: `Studio could not start the render: ${readableError(
              err
            )}. Nothing was counted.`,
          };
        }
      },
    });
  }
}
