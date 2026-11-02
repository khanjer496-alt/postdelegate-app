import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class StudioTemplatesTool implements AgentToolInterface {
  constructor(private _studioService: StudioService) {}
  name = 'studioTemplatesTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'studioTemplatesTool',
      mcp: {
        annotations: {
          title: 'List Studio Templates',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `List the Studio templates that turn videos of the media library into vertical 1080x1920 videos, rendered by PostDelegate.
                    Every template has an identifier, a plain description and "schema", the JSON schema of the spec to pass to 'studioRenderTool'.
                    Always read the schema before rendering and follow it exactly: times are seconds on the source video, and a video is 90 seconds at most after speed changes.
                    Media are only ever the "mediaId" of a media already in the media library: find it with 'mediaListTool', or add a public file first with 'uploadFromUrlTool'. Urls are never accepted.
                    When "captions" is true, pass what is said in captions.script and leave captions.words out: Studio times the words over the clip.
                    When "ai" is true, write the script yourself and keep the defaults of the schema: they render without an AI key. An AI voice or AI stills need the workspace's own OpenAI key, only turn them on when the user asks and has one.
      `,
      inputSchema: z.object({}),
      outputSchema: z.object({
        templates: z.array(
          z.object({
            identifier: z.string(),
            title: z.string(),
            description: z.string(),
            captions: z.boolean(),
            ai: z.boolean(),
            schema: z.any(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        return {
          templates: this._studioService.getTemplateSchemas(),
        };
      },
    });
  }
}
