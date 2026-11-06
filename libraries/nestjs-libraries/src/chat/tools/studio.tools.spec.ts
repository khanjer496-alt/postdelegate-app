jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/studio/studio.service',
  () => ({ StudioService: class {} })
);

import 'reflect-metadata';
import { BadRequestException, HttpException } from '@nestjs/common';
import { StudioTemplatesTool } from '@gitroom/nestjs-libraries/chat/tools/studio.templates.tool';
import { StudioRenderTool } from '@gitroom/nestjs-libraries/chat/tools/studio.render.tool';
import { StudioRenderStatusTool } from '@gitroom/nestjs-libraries/chat/tools/studio.render.status.tool';
import { StudioCancelTool } from '@gitroom/nestjs-libraries/chat/tools/studio.cancel.tool';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { readFileSync } from 'fs';
import { join } from 'path';

const MEDIA_ID = '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f';

// the request context the dashboard chat and the MCP server fill
const contextFor = (orgId: string) => {
  const values = new Map<string, string>([
    ['organization', JSON.stringify({ id: orgId })],
  ]);
  return {
    requestContext: {
      get: (key: string) => values.get(key),
      set: (key: string, value: string) => values.set(key, value),
    },
  };
};

const execute = (tool: any, input: unknown, orgId = 'org-1') =>
  tool.run().execute(input, contextFor(orgId));

describe('Studio tools', () => {
  let studioService: Record<string, jest.Mock>;

  beforeEach(() => {
    studioService = {
      getTemplateSchemas: jest.fn().mockReturnValue([
        {
          identifier: 'hook-over-clip',
          title: 'Hook over clip',
          description: 'A clip with a hook',
          captions: false,
          ai: false,
          schema: { type: 'object' },
        },
      ]),
      renderFromSpec: jest
        .fn()
        .mockResolvedValue({ id: 'render-1', projectId: 'project-1' }),
      waitForRender: jest.fn(),
      cancelRender: jest.fn(),
    };
  });

  it('are registered for MCP and the in-app agent', () => {
    // tool.list pulls every provider in, so its source is read instead: the
    // MCP server and the in-app agent both load the tools of that list
    const list = readFileSync(join(__dirname, 'tool.list.ts'), 'utf8')
      .split('export const toolList = [')[1]
      .split('];')[0];
    for (const name of [
      'StudioTemplatesTool',
      'StudioRenderTool',
      'StudioRenderStatusTool',
      'StudioCancelTool',
    ]) {
      expect(list).toMatch(new RegExp(`\\b${name},`));
    }
    for (const Tool of [
      StudioTemplatesTool,
      StudioRenderTool,
      StudioRenderStatusTool,
      StudioCancelTool,
    ]) {
      const tool: AgentToolInterface & { name: string } = new Tool(
        studioService as any
      );
      // not MCP only, so the in-app agent gets them too; an older
      // self-hosted instance without them can still connect
      expect(tool.mcpOnly).toBeUndefined();
      expect(tool.optionalOnSelfHosted).toBe(true);
      expect(tool.run().id).toBe(tool.name);
    }
  });

  it('mark themselves like the other tools', () => {
    const annotations = (Tool: any) =>
      new Tool(studioService as any).run().mcp.annotations;

    expect(annotations(StudioTemplatesTool)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(annotations(StudioRenderTool)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(annotations(StudioRenderStatusTool)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(annotations(StudioCancelTool)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
  });

  it('say that rendering never posts', () => {
    const render = new StudioRenderTool(studioService as any).run();
    const status = new StudioRenderStatusTool(studioService as any).run();

    expect(render.description).toContain(
      'never creates, schedules or publishes a post'
    );
    expect(render.description).toContain('Urls are never accepted');
    expect(status.description).toContain('integrationSchedulePostTool');
    expect(status.description).toContain('Approvals');
  });

  describe('studioTemplatesTool', () => {
    it('returns the templates with their schemas', async () => {
      await expect(
        execute(new StudioTemplatesTool(studioService as any), {})
      ).resolves.toEqual({
        templates: [
          expect.objectContaining({
            identifier: 'hook-over-clip',
            schema: { type: 'object' },
          }),
        ],
      });
    });
  });

  describe('studioRenderTool', () => {
    const tool = () => new StudioRenderTool(studioService as any);
    const input = {
      template: 'hook-over-clip',
      spec: { input: { mediaId: MEDIA_ID } },
    };

    it('renders for the workspace of the request', async () => {
      await expect(execute(tool(), input, 'org-7')).resolves.toEqual({
        renderId: 'render-1',
        projectId: 'project-1',
      });
      expect(studioService.renderFromSpec).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'org-7' }),
        { template: 'hook-over-clip', spec: input.spec, name: undefined }
      );
    });

    it('validates its input', async () => {
      const schema = tool().run().inputSchema as any;

      expect(schema.safeParse(input).success).toBe(true);
      expect(schema.safeParse({ spec: input.spec }).success).toBe(false);
      expect(
        schema.safeParse({ template: 'hook-over-clip', spec: 'a url' }).success
      ).toBe(false);
      expect(
        schema.safeParse({ ...input, name: 'x'.repeat(101) }).success
      ).toBe(false);
      expect(schema.safeParse({ ...input, name: '' }).success).toBe(false);

      const result = await execute(tool(), { template: 'hook-over-clip' });
      expect(result.error).toBeTruthy();
      expect(studioService.renderFromSpec).not.toHaveBeenCalled();
    });

    it('surfaces a missing plan', async () => {
      studioService.renderFromSpec.mockRejectedValue(
        new HttpException(
          'Studio needs an active plan. Pick one in Billing to render videos.',
          406
        )
      );

      const result = await execute(tool(), input);
      expect(result.error).toContain('Studio needs an active plan');
      expect(result.error).toContain('Nothing was counted');
    });

    it('surfaces the fair use limits', async () => {
      studioService.renderFromSpec.mockRejectedValueOnce(
        new HttpException(
          '30 videos were rendered in the last 24 hours, the fair use limit. Try again later.',
          429
        )
      );
      expect((await execute(tool(), input)).error).toContain(
        'the fair use limit'
      );

      studioService.renderFromSpec.mockRejectedValueOnce(
        new HttpException(
          'Studio is busy right now, try again in a few minutes',
          429
        )
      );
      expect((await execute(tool(), input)).error).toContain('Studio is busy');
    });

    it('lists every validation message of the spec', async () => {
      studioService.renderFromSpec.mockRejectedValue(
        new BadRequestException([
          'trim.start should not be null or undefined',
          'hook.text must be shorter than or equal to 120 characters',
        ])
      );

      const result = await execute(tool(), input);
      expect(result.error).toContain('trim.start should not be null');
      expect(result.error).toContain('hook.text must be shorter');
    });

    it('surfaces the media of another workspace being rejected', async () => {
      studioService.renderFromSpec.mockRejectedValue(
        new BadRequestException(
          `Media ${MEDIA_ID} is not in the media library of this workspace`
        )
      );

      expect((await execute(tool(), input)).error).toContain(
        'is not in the media library of this workspace'
      );
    });

    it('never shows an internal error to the model', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      studioService.renderFromSpec.mockRejectedValue(
        new Error('connect ECONNREFUSED 10.0.0.5:5432')
      );

      const result = await execute(tool(), input);
      expect(result.error).toContain('Something went wrong');
      expect(result.error).not.toContain('10.0.0.5');
      spy.mockRestore();
    });
  });

  describe('studioRenderStatusTool', () => {
    const tool = () => new StudioRenderStatusTool(studioService as any);

    it('waits within the MCP timeout and returns the media when done', async () => {
      studioService.waitForRender.mockResolvedValue({
        id: 'render-1',
        status: 'completed',
        progress: 100,
        seconds: 20,
        mediaId: 'media-9',
        path: 'https://media.example/out.mp4',
        thumbnail: 'https://media.example/out.jpg',
        error: null,
      });

      await expect(
        execute(tool(), { renderId: 'render-1' }, 'org-7')
      ).resolves.toEqual({
        status: 'completed',
        step: 'completed',
        progress: 100,
        seconds: 20,
        mediaId: 'media-9',
        path: 'https://media.example/out.mp4',
        thumbnail: 'https://media.example/out.jpg',
        error: undefined,
      });
      expect(studioService.waitForRender).toHaveBeenCalledWith(
        'org-7',
        'render-1',
        25
      );
    });

    it('reports a render still going as pending', async () => {
      studioService.waitForRender.mockResolvedValue({
        id: 'render-1',
        status: 'rendering',
        progress: 40,
        seconds: 20,
        mediaId: null,
        path: null,
        thumbnail: null,
        error: null,
      });

      await expect(
        execute(tool(), { renderId: 'render-1' })
      ).resolves.toMatchObject({
        status: 'pending',
        step: 'rendering',
        progress: 40,
        mediaId: undefined,
      });
    });

    it('passes failures and cancels through', async () => {
      studioService.waitForRender.mockResolvedValueOnce({
        status: 'failed',
        progress: 10,
        seconds: 20,
        error: 'A video of this project was removed from the media library.',
      });
      await expect(
        execute(tool(), { renderId: 'render-1' })
      ).resolves.toMatchObject({
        status: 'failed',
        error: 'A video of this project was removed from the media library.',
      });

      studioService.waitForRender.mockResolvedValueOnce({
        status: 'cancelled',
        progress: 0,
        seconds: 20,
      });
      await expect(
        execute(tool(), { renderId: 'render-1' })
      ).resolves.toMatchObject({ status: 'cancelled' });
    });

    it('does not find the render of another workspace', async () => {
      studioService.waitForRender.mockRejectedValue(
        new HttpException('Render not found', 404)
      );

      await expect(
        execute(tool(), { renderId: 'render-1' }, 'org-2')
      ).resolves.toEqual({
        error: 'Studio render lookup failed: Render not found',
      });
    });
  });

  describe('studioCancelTool', () => {
    it('cancels in the workspace of the request', async () => {
      studioService.cancelRender.mockResolvedValue({ status: 'cancelled' });

      await expect(
        execute(
          new StudioCancelTool(studioService as any),
          { renderId: 'render-1' },
          'org-7'
        )
      ).resolves.toEqual({ status: 'cancelled' });
      expect(studioService.cancelRender).toHaveBeenCalledWith(
        'org-7',
        'render-1'
      );
    });

    it('surfaces why it could not cancel', async () => {
      studioService.cancelRender.mockRejectedValue(
        new HttpException('The render could not be cancelled, try again', 503)
      );

      expect(
        (
          await execute(new StudioCancelTool(studioService as any), {
            renderId: 'render-1',
          })
        ).error
      ).toContain('try again');
    });
  });
});
