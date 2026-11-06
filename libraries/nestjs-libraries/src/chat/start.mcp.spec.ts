const mockServers: any[] = [];
jest.mock('@mastra/mcp', () => {
  const { getAuth } = jest.requireActual(
    '@gitroom/nestjs-libraries/chat/async.storage'
  );
  return {
    MCPServer: class {
      config: any;
      constructor(config: any) {
        this.config = config;
        mockServers.push(this);
      }
      getToolListInfo() {
        return {
          tools: Object.entries(this.config.tools).map(
            ([id, tool]: [string, any]) => ({
              id,
              name: tool.id || id,
              description: tool.description,
              inputSchema: { type: 'object' },
            })
          ),
        };
      }
      async startHTTP({ res }: any) {
        res.status(200).json({ handledBy: 'mcp', org: getAuth()?.id });
      }
    },
  };
});
jest.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({
  MastraService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/chat/load.tools.service', () => ({
  LoadToolsService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({
  OAuthService: class {},
  selfHostedRelayEnabled: () => false,
}));
jest.mock('@gitroom/nestjs-libraries/chat/mcp.relay.service', () => ({
  McpRelayService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => ({ publicUrl: () => 'https://media.example.com/' }),
    clippingEnabled: () => false,
  },
}));
jest.mock('@gitroom/nestjs-libraries/chat/ui/upload.widget', () => ({
  UPLOAD_WIDGET_URI: 'ui://postiz/upload',
  uploadWidgetHtml: () => '<html></html>',
}));
jest.mock('@gitroom/nestjs-libraries/chat/ui/clipping.widget', () => ({
  CLIPPING_WIDGET_URI: 'ui://postiz/clipping',
  clippingWidgetHtml: () => '<html></html>',
}));

import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startMcp } from '@gitroom/nestjs-libraries/chat/start.mcp';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { McpRelayService } from '@gitroom/nestjs-libraries/chat/mcp.relay.service';

const agent = {
  name: 'postdelegate',
  getDescription: () => 'Agent that helps schedule and list social media posts',
  listTools: async () => ({
    generateImageTool: {
      id: 'generateImageTool',
      description: 'Generate an image',
      mcp: {
        annotations: {
          title: 'Generate Image',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
    },
    integrationList: {
      id: 'integrationList',
      description: 'List the channels',
      mcp: {
        annotations: {
          title: 'List Integrations',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    },
  }),
  generate: jest.fn(async () => ({ text: 'Scheduled', steps: [] })),
};

const services = new Map<unknown, unknown>([
  [MastraService, { mastra: async () => ({ getAgent: () => agent }) }],
  [LoadToolsService, { loadTools: async () => ({}) }],
  [
    OrganizationService,
    {
      getOrgByApiKey: async (key: string) =>
        key === 'key-123' ? { id: 'org-key' } : null,
    },
  ],
  [
    OAuthService,
    {
      getOrgByOAuthToken: async (token: string) =>
        token === 'pos_valid'
          ? { organization: { id: 'org-oauth' }, oauthApp: { name: 'Smithery' } }
          : null,
      getSelfHostedByAccessToken: async () => null,
    },
  ],
  [McpRelayService, {}],
]);

const env = { ...process.env };
let server: Server;
let base: string;

const boot = async (extraEnv: Record<string, string> = {}) => {
  mockServers.length = 0;
  process.env = {
    ...env,
    NEXT_PUBLIC_BACKEND_URL: 'https://app.example.com/api',
    FRONTEND_URL: 'https://app.example.com',
    STRIPE_SECRET_KEY: '',
    ...extraEnv,
  };
  const app = express();
  await startMcp({
    get: (token: unknown) => services.get(token),
    use: (...args: any[]) => (app.use as any)(...args),
  } as any);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const shutdown = () =>
  new Promise<void>((resolve) => server.close(() => resolve()));

const mcpPost = (path: string, headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

const expectMcpCors = (response: Response) => {
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  // the * wildcard never covers Authorization, it has to be listed
  expect(response.headers.get('access-control-allow-headers')).toContain(
    'Authorization'
  );
};

describe('startMcp', () => {
  beforeAll(() => boot());
  afterAll(async () => {
    await shutdown();
    process.env = env;
  });

  describe('/mcp API key auth', () => {
    it.each([
      ['a bare key', 'key-123'],
      ['a Bearer key', 'Bearer key-123'],
      ['a lowercase bearer key', 'bearer key-123'],
    ])('accepts %s', async (_, authorization) => {
      const response = await mcpPost('/mcp', { Authorization: authorization });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ handledBy: 'mcp', org: 'org-key' });
    });

    it.each([
      ['a bare OAuth token', 'pos_valid'],
      ['a Bearer OAuth token', 'Bearer pos_valid'],
    ])('accepts %s', async (_, authorization) => {
      const response = await mcpPost('/mcp', { Authorization: authorization });

      expect(await response.json()).toEqual({
        handledBy: 'mcp',
        org: 'org-oauth',
      });
    });

    it('rejects an unknown or revoked key, bare or with Bearer, as invalid_token', async () => {
      for (const authorization of ['nope', 'Bearer nope', 'pos_revoked']) {
        const response = await mcpPost('/mcp', { Authorization: authorization });
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe(
          'Bearer resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/api/mcp", error="invalid_token", error_description="Invalid API Key or OAuth token"'
        );
      }
    });

    it('points a client without credentials at the resource metadata', async () => {
      const response = await mcpPost('/mcp');

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe(
        'Bearer resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/api/mcp"'
      );
      expectMcpCors(response);
    });

    it('treats "Bearer" with nothing after it as no credentials', async () => {
      const response = await mcpPost('/mcp', { Authorization: 'Bearer ' });

      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Missing Authorization header');
    });
  });

  describe('CORS', () => {
    it.each(['/mcp', '/mcp/key-123', '/mcp-oauth-dynamic', '/mcp-oauth-claude', '/sse/key-123'])(
      'answers the preflight of %s without credentials',
      async (path) => {
        const response = await fetch(base + path, {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://smithery.ai',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization, content-type',
          },
        });

        expect(response.status).toBe(204);
        expectMcpCors(response);
      }
    );

    it('sets the headers on MCP responses', async () => {
      expectMcpCors(await mcpPost('/mcp', { Authorization: 'key-123' }));
      expectMcpCors(await mcpPost('/mcp/key-123'));
    });

    it('sets the headers on the 401 of an OAuth-only path', async () => {
      const response = await mcpPost('/mcp-oauth-dynamic');

      expect(response.status).toBe(401);
      expectMcpCors(response);
      expect(response.headers.get('www-authenticate')).toContain(
        'oauth-protected-resource/mcp-oauth-dynamic'
      );
    });
  });

  describe('/.well-known/oauth-protected-resource', () => {
    it('serves the /mcp resource as JSON at its path-inserted form', async () => {
        const response = await fetch(
          `${base}/.well-known/oauth-protected-resource/api/mcp`
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect(await response.json()).toEqual({
          resource: 'https://app.example.com/api/mcp',
          authorization_servers: ['https://app.example.com/mcp-oauth-dynamic'],
          scopes_supported: ['mcp:read', 'mcp:write'],
          bearer_methods_supported: ['header'],
        });
    });

    it('leaves the root unanswered, or clients would demand OAuth for /mcp/:id', async () => {
      const response = await fetch(`${base}/.well-known/oauth-protected-resource`);

      expect(response.status).toBe(404);
    });

    it.each(['POST', 'PUT', 'DELETE'])(
      'moves on for %s instead of leaving the request hanging',
      async (method) => {
        for (const path of ['/api/mcp', '/mcp-oauth-dynamic']) {
          const response = await fetch(
            `${base}/.well-known/oauth-protected-resource${path}`,
            { method, signal: AbortSignal.timeout(2000) }
          );
          expect(response.status).toBe(404);
        }
      }
    );

    it('keeps serving the OAuth-only resources at their own path', async () => {
      const response = await fetch(
        `${base}/.well-known/oauth-protected-resource/mcp-oauth-dynamic`
      );

      expect(await response.json()).toMatchObject({
        resource: 'https://app.example.com/mcp-oauth-dynamic',
      });
    });

    it('answers its preflight', async () => {
      const response = await fetch(`${base}/.well-known/oauth-protected-resource/api/mcp`, {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('does not answer for other paths', async () => {
      const response = await fetch(
        `${base}/.well-known/oauth-protected-resource/somewhere-else`
      );

      expect(response.status).toBe(404);
    });
  });

  describe('server card', () => {
    it.each(['/.well-known/mcp.json', '/.well-known/mcp/server-card.json'])(
      'is served as JSON with CORS at %s',
      async (path) => {
        const response = await fetch(base + path);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(response.headers.get('access-control-allow-origin')).toBe('*');

        const card = await response.json();
        expect(card).toMatchObject({
          name: 'PostDelegate',
          serverInfo: { name: 'PostDelegate' },
          documentationUrl: 'https://postdelegate.com/docs/mcp',
          transport: {
            type: 'streamable-http',
            endpoint: 'https://app.example.com/api/mcp',
          },
          authentication: {
            required: true,
            schemes: ['bearer', 'oauth2'],
            oauth2: {
              protectedResourceMetadata:
                'https://app.example.com/.well-known/oauth-protected-resource/api/mcp',
              authorizationServers: ['https://app.example.com/mcp-oauth-dynamic'],
              dynamicClientRegistration: true,
            },
          },
        });
        expect(card.endpoints.map((e: { url: string }) => e.url)).toEqual([
          'https://app.example.com/api/mcp',
          'https://app.example.com/mcp-oauth-dynamic',
        ]);
      }
    );

    it('lists the directory-safe tools with their annotations', async () => {
      const card = await (await fetch(`${base}/.well-known/mcp.json`)).json();
      const names = card.tools.map((tool: { name: string }) => tool.name);

      // the Claude list: no agent, no AI media generation, no clipping
      expect(names).toEqual(['integrationList']);
      for (const tool of card.tools) {
        expect(tool.title).toEqual(expect.any(String));
        expect(tool.annotations).toMatchObject({
          readOnlyHint: expect.any(Boolean),
          destructiveHint: expect.any(Boolean),
          openWorldHint: expect.any(Boolean),
        });
      }
    });

    it('only answers reads', async () => {
      const response = await fetch(`${base}/.well-known/mcp.json`, {
        method: 'POST',
      });

      expect(response.status).toBe(404);
    });

    it('answers its preflight', async () => {
      const response = await fetch(`${base}/.well-known/mcp.json`, {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  describe('servers', () => {
    it('never registers the agent through the annotation-less agents option', () => {
      for (const mcpServer of mockServers) {
        expect(mcpServer.config.agents).toBeUndefined();
      }
    });

    it('offers ask_postdelegate as an annotated tool on the API key server', async () => {
      const apiKeyServer = mockServers[0];
      const tool = apiKeyServer.config.tools.ask_postdelegate;

      expect(tool.mcp.annotations).toEqual({
        title: 'Ask the PostDelegate Agent',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      });
      expect(tool.outputSchema).toBeDefined();
      // the directory-facing OAuth servers keep leaving it out
      for (const mcpServer of mockServers.slice(1)) {
        expect(mcpServer.config.tools.ask_postdelegate).toBeUndefined();
      }
    });

    it('returns the agent answer as text', async () => {
      const tool = mockServers[0].config.tools.ask_postdelegate;
      const requestContext = new Map<string, string>();

      await expect(
        tool.execute({ message: 'Schedule a post' }, { requestContext })
      ).resolves.toEqual({ text: 'Scheduled' });
      expect(agent.generate).toHaveBeenCalledWith('Schedule a post', {
        requestContext,
      });
      // "ui" set at all would make the agent offer the app's post modal
      expect(requestContext.has('ui')).toBe(false);
    });
  });

  describe('ended subscriptions', () => {
    beforeAll(async () => {
      await shutdown();
      // billing on, and the test orgs have no subscription
      await boot({ STRIPE_SECRET_KEY: 'sk_test_unit' });
    });
    afterAll(async () => {
      await shutdown();
      await boot();
    });

    it.each([
      ['/mcp', { Authorization: 'key-123' }],
      ['/mcp/key-123', {}],
      ['/mcp-oauth-dynamic', { Authorization: 'Bearer pos_valid' }],
    ])('%s answers 403 with the CORS headers, after auth', async (path, headers) => {
      const response = await mcpPost(path, headers as Record<string, string>);

      expect(response.status).toBe(403);
      expectMcpCors(response);
    });

    it('still answers preflights and a bad key first', async () => {
      const preflight = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
      expect(preflight.status).toBe(204);

      const bad = await mcpPost('/mcp', { Authorization: 'nope' });
      expect(bad.status).toBe(401);
    });
  });

  describe('/.well-known/openai-apps-challenge', () => {
    it('is a 404 when OPENAI_APPS_CHALLENGE is not set', async () => {
      const response = await fetch(`${base}/.well-known/openai-apps-challenge`);

      expect(response.status).toBe(404);
    });

    it('returns OPENAI_APPS_CHALLENGE as text when set', async () => {
      await shutdown();
      await boot({ OPENAI_APPS_CHALLENGE: 'challenge-token' });

      const response = await fetch(`${base}/.well-known/openai-apps-challenge`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(await response.text()).toBe('challenge-token');
    });
  });
});
