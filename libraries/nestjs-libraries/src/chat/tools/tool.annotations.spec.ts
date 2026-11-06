// the tools are built with stub services, their modules only need to load
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
  socialIntegrationList: [],
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service',
  () => ({ ClippingService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  RefreshToken: class {},
}));
jest.mock('@gitroom/nestjs-libraries/chat/validation.schemas.helper', () => ({
  getValidationSchemas: () => ({}),
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => ({}),
    clippingEnabled: () => false,
  },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service',
  () => ({ ApprovalPolicyService: class {}, ApprovalActor: {} })
);
jest.mock('@gitroom/nestjs-libraries/chat/ui/upload.widget', () => ({
  UPLOAD_WIDGET_URI: 'ui://postiz/upload',
}));
jest.mock('@gitroom/nestjs-libraries/chat/ui/clipping.widget', () => ({
  CLIPPING_WIDGET_URI: 'ui://postiz/clipping',
}));
jest.mock('@gitroom/nestjs-libraries/videos/video.manager', () => ({
  VideoManager: class {},
}));

import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { askAgentTool } from '@gitroom/nestjs-libraries/chat/tools/ask.agent.tool';
import { GenerateVideoTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.tool';
import { GenerateVideoOptionsTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.options.tool';
import { VideoFunctionTool } from '@gitroom/nestjs-libraries/chat/tools/video.function.tool';
import { VideoStatusTool } from '@gitroom/nestjs-libraries/chat/tools/video.status.tool';
import { ClippingTool } from '@gitroom/nestjs-libraries/chat/tools/clipping.tool';
import { ClippingStatusTool } from '@gitroom/nestjs-libraries/chat/tools/clipping.status.tool';
import { ClippingWidgetTicketTool } from '@gitroom/nestjs-libraries/chat/tools/clipping.widget.ticket.tool';
import { GenerateImageTool } from '@gitroom/nestjs-libraries/chat/tools/generate.image.tool';

// any service method answers an empty list, enough for run() to build a tool
const stubService = new Proxy({}, { get: () => () => [] });

// GenerateVideoTool and VideoStatusTool get the VideoManager second, after
// the MediaService; the two others get it first
const videoDeps = (Tool: unknown, videos: unknown[]) => {
  const videoManager = { getAllVideos: () => videos };
  return Tool === GenerateVideoTool || Tool === VideoStatusTool
    ? [stubService, videoManager]
    : [videoManager];
};

const build = (Tool: any, ...deps: unknown[]): AgentToolInterface =>
  new Tool(
    ...Array.from({ length: Tool.length }, (_, index) =>
      index < deps.length ? deps[index] : stubService
    )
  );

const tools = [
  ...toolList.map((Tool) => {
    const instance = build(Tool);
    return { name: instance.name, tool: instance.run() as any };
  }),
  {
    name: 'ask_postdelegate',
    tool: askAgentTool({
      name: 'postdelegate',
      getDescription: () => 'Agent',
    } as any) as any,
  },
];

describe('MCP tool metadata', () => {
  it.each(tools.map(({ name, tool }) => [name, tool]))(
    '%s has a title, the three hints and an output schema',
    (_, tool) => {
      const annotations = tool.mcp?.annotations;

      expect(annotations).toMatchObject({
        title: expect.any(String),
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
      });
      expect(annotations.title.trim()).not.toBe('');
      expect(tool.outputSchema).toBeDefined();
      // a read-only tool can never be destructive
      if (annotations.readOnlyHint) {
        expect(annotations.destructiveHint).toBe(false);
      }
    }
  );

  it('marks the tools that delete or replace data as destructive', () => {
    const byName = Object.fromEntries(
      tools.map(({ name, tool }) => [name, tool.mcp.annotations])
    );

    expect(byName.deletePostTool.destructiveHint).toBe(true);
    expect(byName.ask_postdelegate.destructiveHint).toBe(true);
  });
});

describe('MCP tools of features that are not configured', () => {
  it.each([
    ['generateVideoTool', GenerateVideoTool],
    ['generateVideoOptions', GenerateVideoOptionsTool],
    ['videoFunctionTool', VideoFunctionTool],
    ['videoStatusTool', VideoStatusTool],
  ])('%s is hidden without a video provider', (_, Tool) => {
    expect(build(Tool, ...videoDeps(Tool, [])).available!()).toBe(false);
  });

  it.each([
    ['generateVideoTool', GenerateVideoTool],
    ['generateVideoOptions', GenerateVideoOptionsTool],
    ['videoFunctionTool', VideoFunctionTool],
    ['videoStatusTool', VideoStatusTool],
  ])('%s is listed once a video provider is configured', (_, Tool) => {
    const deps = videoDeps(Tool, [{ identifier: 'seedance' }]);

    expect(build(Tool, ...deps).available!()).toBe(true);
  });

  it.each([
    ['clippingTool', ClippingTool],
    ['clippingStatusTool', ClippingStatusTool],
    ['clippingWidgetTicketTool', ClippingWidgetTicketTool],
  ])('%s is hidden without the clipping keys', (_, Tool) => {
    expect(build(Tool).available!()).toBe(false);
  });

  it('generateImageTool explains the missing OpenAI key instead of failing silently', async () => {
    const tool = build(GenerateImageTool, {
      generateImage: async () => {
        throw new Error('Add your OpenAI key in Settings → AI');
      },
    }).run() as any;

    expect(tool.description).toContain("workspace's own OpenAI key");
    await expect(
      tool.execute(
        { prompt: 'a cat' },
        {
          requestContext: new Map([
            ['organization', JSON.stringify({ id: 'org-1' })],
          ]),
        }
      )
    ).resolves.toEqual({
      error:
        'Image generation failed: Add your OpenAI key in Settings → AI.',
    });
  });
});

describe('MCP tools and money', () => {
  it('no tool can charge, refund or reset credits', () => {
    const names = tools.map(({ name }) => name.toLowerCase());

    for (const forbidden of ['credit', 'payment', 'charge', 'billing', 'checkout', 'refund', 'subscription']) {
      expect(names.filter((name) => name.includes(forbidden))).toEqual([]);
    }
  });
});
