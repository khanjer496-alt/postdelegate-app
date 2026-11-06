import { INestApplication } from '@nestjs/common';
import { Request, Response } from 'express';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { MCPServer } from '@mastra/mcp';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import {
  OAuthService,
  selfHostedRelayEnabled,
} from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { runWithContext } from './async.storage';
import { createOAuthMiddleware } from './oauth-middleware';
import {
  extractBearerOrBareToken,
  generateWWWAuthenticateHeader,
} from './oauth-types';
import { UPLOAD_WIDGET_URI, uploadWidgetHtml } from '@gitroom/nestjs-libraries/chat/ui/upload.widget';
import { CLIPPING_WIDGET_URI, clippingWidgetHtml } from '@gitroom/nestjs-libraries/chat/ui/clipping.widget';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { McpRelayService } from '@gitroom/nestjs-libraries/chat/mcp.relay.service';
import {
  subscriptionProblem,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  ASK_AGENT_TOOL_NAME,
  askAgentTool,
} from '@gitroom/nestjs-libraries/chat/tools/ask.agent.tool';
const fixAcceptHeader = (req: Request) => {
  const value = 'application/json, text/event-stream';
  req.headers.accept = value;
  const idx = req.rawHeaders.findIndex((h) => h.toLowerCase() === 'accept');
  if (idx !== -1) {
    req.rawHeaders[idx + 1] = value;
  } else {
    req.rawHeaders.push('Accept', value);
  }
};

// 2026-07-28 clients hold a subscriptions/listen stream open for the whole
// session, and the tool list never changes - the stream ends once the
// subscription had time to be acknowledged
const endListenStream = (req: Request, res: Response) => {
  if (req.headers['mcp-method'] !== 'subscriptions/listen') {
    return;
  }

  const timer = setTimeout(() => res.end(), 10000);
  res.on('close', () => clearTimeout(timer));
};

// Browser-based MCP clients (directory playgrounds, inspectors) call every MCP
// route and discovery document cross-origin. Authorization is listed on its
// own because the * wildcard never covers it. Returns true when it answered
// a preflight
const mcpCors = (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*, Authorization');
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method !== 'OPTIONS') {
    return false;
  }

  res.sendStatus(204);
  return true;
};

const mcpProtocolVersion = '2026-07-28';
const mcpWebsiteUrl = 'https://postdelegate.com';
const mcpDocumentationUrl = `${mcpWebsiteUrl}/docs/mcp`;

const openAiOAuthClientId = process.env.OPENAI_OAUTH_CLIENT_ID?.trim();
const enableOidcEmailClaims = Boolean(openAiOAuthClientId);
// The static app HubSpot agents connect with, see OAuthService
const hubspotOAuthClientId = process.env.HUBSPOT_OAUTH_CLIENT_ID?.trim();
const oauthScopes = [
  ...(enableOidcEmailClaims ? ['openid', 'email'] : []),
  'mcp:read',
  'mcp:write',
];

export const startMcp = async (app: INestApplication) => {
  const mastraService = app.get(MastraService, { strict: false });
  const organizationService = app.get(OrganizationService, { strict: false });
  const oauthService = app.get(OAuthService, { strict: false });
  const loadToolsService = app.get(LoadToolsService, { strict: false });
  const mcpRelayService = app.get(McpRelayService, { strict: false });

  // the organization of a token, and the MCP client it belongs to (the
  // OAuth app name, or "API key"), which marks the posts the agent creates
  const resolveAuthWithSource = async (token: string) => {
    if (token.startsWith('pos_')) {
      const authorization = await oauthService.getOrgByOAuthToken(token);
      if (!authorization) return { auth: null, source: undefined };
      return {
        auth: authorization.organization,
        source: authorization.oauthApp?.name
          ? `${authorization.oauthApp.name} (MCP)`
          : 'MCP client',
      };
    }
    return {
      auth: await organizationService.getOrgByApiKey(token),
      source: 'MCP (API key)',
    };
  };

  const resolveAuth = async (token: string) =>
    (await resolveAuthWithSource(token)).auth;

  // psh_ tokens: a self-hosted Postiz this server relays to (McpRelayService)
  const resolveSelfHosted = (token: string) =>
    oauthService.getSelfHostedByAccessToken(token);

  const mastra = await mastraService.mastra();
  const agent = mastra.getAgent('postdelegate');
  const agentTools = await agent.listTools();
  const tools = {
    ...agentTools,
    // tools that only make sense inside an MCP host (ui:// widgets)
    ...(await loadToolsService.loadTools(true)),
  };
  // the API key server (/mcp, /mcp/:id, /sse/:id) also offers the agent itself
  const apiKeyTools = {
    ...tools,
    [ASK_AGENT_TOOL_NAME]: askAgentTool(agent),
  };

  // The Claude connector directory does not accept AI media generation tools,
  // so the directory-facing endpoint hides them. Direct connections
  // (/mcp, /mcp/:id, /sse/:id) and the ChatGPT app keep the full toolset.
  const claudeHiddenTools = [
    'generateImageTool',
    'generateVideoTool',
    'videoStatusTool',
    'generateVideoOptions',
    'videoFunctionTool',
    // clipping renders new videos (AI picked cuts, burned-in captions)
    'clippingTool',
    'clippingStatusTool',
    'clippingWidgetTicketTool',
  ];
  const withoutClaudeHidden = <T extends Record<string, unknown>>(source: T) =>
    Object.fromEntries(
      Object.entries(source).filter(([name]) => !claudeHiddenTools.includes(name))
    ) as T;
  const claudeTools = withoutClaudeHidden(tools);

  const backendUrl = process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
  // this runs before the backend listens: a bucket url that doesn't parse only
  // costs the widget its thumbnails, never the boot
  let storageOrigin: string | undefined;
  try {
    storageOrigin = new URL(UploadFactory.createStorage().publicUrl!('')).origin;
  } catch (err) {}

  // MCP Apps widgets (ui:// resources). They run in the host's sandboxed iframe,
  // which can only reach the domains listed in the csp
  const appResources = {
    [UPLOAD_WIDGET_URI]: {
      name: 'Upload Media',
      description: 'Upload an image or video from the device to the media library',
      html: uploadWidgetHtml(backendUrl!),
      meta: {
        csp: { connectDomains: [new URL(backendUrl!).origin] },
        // the "Copy link" button of the uploaded media
        permissions: { clipboardWrite: {} },
        prefersBorder: true,
      },
    },
    ...(UploadFactory.clippingEnabled()
      ? {
          [CLIPPING_WIDGET_URI]: {
            name: 'Video Clipping',
            description: 'Progress of a video clipping and the clips it made',
            html: clippingWidgetHtml(backendUrl!),
            meta: {
              csp: {
                connectDomains: [new URL(backendUrl!).origin],
                // the thumbnails of the clips live wherever the storage serves files
                ...(storageOrigin ? { resourceDomains: [storageOrigin] } : {}),
              },
              // the "Copy link" button of a clip
              permissions: { clipboardWrite: {} },
              prefersBorder: true,
            },
          },
        }
      : {}),
  };

  const serverConfig = {
    name: 'PostDelegate MCP',
    version: '1.0.0',
    tools: apiKeyTools,
    appResources,
  };

  const server = new MCPServer({ ...serverConfig, protocolVersion: mcpProtocolVersion });

  // The directory-facing OAuth servers don't offer the agent - a catch-all
  // ask_postdelegate tool is rejected by the ChatGPT and Claude directory reviews
  const oauthServer = new MCPServer({
    name: 'PostDelegate MCP',
    version: '1.0.0',
    protocolVersion: mcpProtocolVersion,
    tools,
    appResources,
  });

  // a widget of a hidden tool is hidden with it
  const { [CLIPPING_WIDGET_URI]: hiddenWidget, ...claudeAppResources } = appResources as Record<string, (typeof appResources)[typeof UPLOAD_WIDGET_URI]>;

  const claudeOauthServer = new MCPServer({
    name: 'PostDelegate MCP',
    version: '1.0.0',
    protocolVersion: mcpProtocolVersion,
    tools: claudeTools,
    appResources: claudeAppResources,
  });

  // Self-hosted connections, built from the agent tools so the ui:// widgets
  // (which upload to this server) are left out
  let selfHostedServer: MCPServer | undefined;
  let claudeSelfHostedServer: MCPServer | undefined;
  if (selfHostedRelayEnabled()) {
    const selfHostedTools = mcpRelayService.tools(agentTools);
    selfHostedServer = new MCPServer({
      name: 'PostDelegate MCP',
      version: '1.0.0',
      protocolVersion: mcpProtocolVersion,
      tools: selfHostedTools,
    });
    claudeSelfHostedServer = new MCPServer({
      name: 'PostDelegate MCP',
      version: '1.0.0',
      protocolVersion: mcpProtocolVersion,
      tools: withoutClaudeHidden(selfHostedTools),
    });
  }

  // Two RFC 8414 path-based issuers backed by the same endpoints and code.
  // /mcp-oauth-chatgpt is what the ChatGPT app submission points at: it does
  // not advertise a registration_endpoint, so the OpenAI builder defaults to
  // the pre-defined client credentials instead of DCR (a fresh path, because
  // OpenAI kept serving its cached copy of the old /mcp-oauth metadata).
  // /mcp-oauth-dynamic keeps DCR for Claude, Cursor and every other
  // self-registering client.
  // HubSpot agents follow the 2025-03-26 MCP authorization spec: they read the
  // metadata from the domain root of the MCP url (no path issuer), connect with
  // a pre-registered client instead of DCR and require the refresh_token
  // grant, so the root is answered only when that client is configured
  const authorizationServers: Record<string, { issuer: string; registration: boolean; refresh: boolean }> = {
    '/mcp-oauth-chatgpt': {
      issuer: new URL('/mcp-oauth-chatgpt', process.env.NEXT_PUBLIC_BACKEND_URL!).toString(),
      registration: false,
      refresh: false,
    },
    '/mcp-oauth-dynamic': {
      issuer: new URL('/mcp-oauth-dynamic', process.env.NEXT_PUBLIC_BACKEND_URL!).toString(),
      registration: true,
      refresh: false,
    },
    ...(hubspotOAuthClientId
      ? {
          '/': {
            issuer: new URL(process.env.NEXT_PUBLIC_BACKEND_URL!).origin,
            registration: false,
            refresh: true,
          },
        }
      : {}),
  };

  const authorizationServerMetadata = (server: { issuer: string; registration: boolean; refresh: boolean }) => ({
    // RFC 8414: metadata served at /.well-known/oauth-authorization-server/<path>
    // belongs to the path-based issuer <backend>/<path>
    issuer: server.issuer,
    authorization_endpoint: `${process.env.FRONTEND_URL}/oauth/authorize`,
    token_endpoint: `${backendUrl}/oauth/token`,
    ...(server.registration && {
      registration_endpoint: `${backendUrl}/oauth/register`,
    }),
    ...(enableOidcEmailClaims && {
      userinfo_endpoint: `${backendUrl}/oauth/userinfo`,
    }),
    response_types_supported: ['code'],
    grant_types_supported: server.refresh
      ? ['authorization_code', 'refresh_token']
      : ['authorization_code'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: oauthScopes,
  });

  // Every OAuth-protected MCP path is its own RFC 9728 protected resource
  // (the token endpoint ignores the RFC 8707 resource param, so the issuers
  // above cover all of them)
  const createResourceMiddleware = (
    mcpPath: string,
    authorizationServer: string,
    resource = new URL(mcpPath, process.env.NEXT_PUBLIC_BACKEND_URL!).toString()
  ) =>
    createOAuthMiddleware({
      oauth: {
        resource,
        authorizationServers: [authorizationServers[authorizationServer].issuer],
        scopesSupported: oauthScopes,
        validateToken: async (token: string) => {
          const org = token.startsWith('psh_')
            ? await resolveSelfHosted(token)
            : await resolveAuth(token);
          if (!org) {
            return { valid: false, error: 'invalid_token', errorDescription: 'Invalid API Key or OAuth token' };
          }
          return { valid: true, subject: token };
        },
      },
      mcpPath,
    });

  const oauthResources: Record<
    string,
    {
      middleware: ReturnType<typeof createOAuthMiddleware>;
      mcpServer: MCPServer;
      selfHostedServer?: MCPServer;
    }
  > = {
    // ChatGPT app submission (pre-defined client credentials, no DCR)
    '/mcp-oauth-chatgpt': { middleware: createResourceMiddleware('/mcp-oauth-chatgpt', '/mcp-oauth-chatgpt'), mcpServer: oauthServer, selfHostedServer },
    // Former ChatGPT path, kept for connectors that were created against it
    '/mcp-oauth': { middleware: createResourceMiddleware('/mcp-oauth', '/mcp-oauth-dynamic'), mcpServer: oauthServer, selfHostedServer },
    // Claude connector directory submission
    '/mcp-oauth-claude': { middleware: createResourceMiddleware('/mcp-oauth-claude', '/mcp-oauth-dynamic'), mcpServer: claudeOauthServer, selfHostedServer: claudeSelfHostedServer },
    // Clients that register themselves through DCR (/oauth/register) - not
    // directory-reviewed, so they get the full toolset (media generation included)
    '/mcp-oauth-dynamic': { middleware: createResourceMiddleware('/mcp-oauth-dynamic', '/mcp-oauth-dynamic'), mcpServer: oauthServer, selfHostedServer },
  };

  // /mcp (public url <backend>/mcp, e.g. https://app.postdelegate.com/api/mcp)
  // takes an API key, but also the OAuth tokens of the DCR issuer, so it is
  // an RFC 9728 protected resource as well. Its metadata is served at the
  // path-inserted well-known only, which its WWW-Authenticate points at: the
  // root stays unanswered, or clients probing it would demand OAuth for the
  // /mcp/:id urls that carry their key
  const apiKeyMcpUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL}/mcp`;
  const apiKeyMcpPath = new URL(apiKeyMcpUrl).pathname;
  const apiKeyResourceMetadataUrl = new URL(
    '/.well-known/oauth-protected-resource' + apiKeyMcpPath,
    apiKeyMcpUrl
  ).toString();
  const apiKeyResourceMiddleware = createResourceMiddleware(
    '/mcp',
    '/mcp-oauth-dynamic',
    apiKeyMcpUrl
  );

  // The server card (/.well-known/mcp/server-card.json, also served as
  // /.well-known/mcp.json) that MCP directories read to list the server
  // without connecting: endpoints, how to authenticate and the tools. The
  // tools are the directory-safe ones (the Claude list: no agent, no AI media
  // generation, no clipping), which every endpoint offers
  const dynamicIssuer = authorizationServers['/mcp-oauth-dynamic'].issuer;
  const oauthMcpUrl = new URL('/mcp-oauth-dynamic', process.env.NEXT_PUBLIC_BACKEND_URL!).toString();
  // MCP lists a tool under its id, which is not always its key in claudeTools
  const annotationsById = Object.fromEntries(
    Object.values(claudeTools as Record<string, { id: string; mcp?: { annotations?: { title?: string } } }>).map(
      (tool) => [tool.id, tool.mcp?.annotations]
    )
  );
  const serverCardTools = (await claudeOauthServer.getToolListInfo()).tools.map((tool) => {
    const annotations = annotationsById[tool.name];
    return {
      name: tool.name,
      ...(annotations?.title ? { title: annotations.title } : {}),
      description: tool.description?.replace(/\s+/g, ' ').trim(),
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      ...(annotations ? { annotations } : {}),
    };
  });
  const serverCard = {
    name: 'PostDelegate',
    serverInfo: {
      name: 'PostDelegate',
      title: 'PostDelegate',
      version: '1.0.0',
    },
    description:
      'Schedule, list, update and delete social media posts on the channels connected to a PostDelegate workspace, and upload the media they use.',
    version: '1.0.0',
    protocolVersion: mcpProtocolVersion,
    websiteUrl: mcpWebsiteUrl,
    documentationUrl: mcpDocumentationUrl,
    iconUrl: `${mcpWebsiteUrl}/postdelegate-icon-512.png`,
    transport: {
      type: 'streamable-http',
      endpoint: apiKeyMcpUrl,
    },
    endpoints: [
      {
        type: 'streamable-http',
        url: apiKeyMcpUrl,
        authentication: ['apiKey', 'oauth2'],
      },
      {
        type: 'streamable-http',
        url: oauthMcpUrl,
        authentication: ['oauth2'],
      },
    ],
    authentication: {
      required: true,
      schemes: ['bearer', 'oauth2'],
      apiKey: {
        in: 'header',
        name: 'Authorization',
        // the bare key is accepted too
        format: 'Bearer <API key>',
        documentationUrl: mcpDocumentationUrl,
      },
      oauth2: {
        protectedResourceMetadata: apiKeyResourceMetadataUrl,
        authorizationServers: [dynamicIssuer],
        authorizationServerMetadata: new URL(
          '/.well-known/oauth-authorization-server/mcp-oauth-dynamic',
          dynamicIssuer
        ).toString(),
        dynamicClientRegistration: true,
        scopes: oauthScopes,
      },
    },
    capabilities: {
      tools: { listChanged: false },
      resources: {},
    },
    tools: serverCardTools,
  };

  app.use(['/.well-known/mcp.json', '/.well-known/mcp/server-card.json'], (req: Request, res: Response, next: () => void) => {
    if (
      (req.path !== '/' && req.path !== '') ||
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    ) {
      next();
      return;
    }

    if (mcpCors(req, res)) return;
    res.setHeader('Cache-Control', 'max-age=3600');
    res.json(serverCard);
  });

  // The domain verification of the ChatGPT app (OPENAI_APP_CHALLANGE is the
  // name it was first installed under)
  const openAiAppsChallenge =
    process.env.OPENAI_APPS_CHALLENGE?.trim() ||
    process.env.OPENAI_APP_CHALLANGE;
  if (openAiAppsChallenge) {
    app.use('/.well-known/openai-apps-challenge', (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/plain');
      res.send(openAiAppsChallenge);
    });
  }

  app.use('/.well-known/oauth-protected-resource', async (req: Request, res: Response, next: () => void) => {
    // The paths in oauthResources are OAuth-only resources; the
    // path-inserted form of /mcp describes the API key server above. The
    // middleware only answers GET and OPTIONS, anything else moves on
    const middleware =
      oauthResources[req.path]?.middleware ||
      (req.path === apiKeyMcpPath ? apiKeyResourceMiddleware : undefined);
    if (!middleware || !['GET', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }

    const url = new URL('/.well-known/oauth-protected-resource', process.env.NEXT_PUBLIC_BACKEND_URL);
    const result = await middleware(req, res, url);
    if (!result.handled) {
      next();
    }
  });

  app.use('/.well-known/oauth-authorization-server', async (req: Request, res: Response, next: () => void) => {
    const server = authorizationServers[req.path];
    if (!server) {
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'max-age=3600');
    res.json(authorizationServerMetadata(server));
  });

  app.use('/.well-known/openid-configuration', async (req: Request, res: Response, next: () => void) => {
    const server = authorizationServers[req.path];
    // the root issuer is HubSpot's, which never gets email claims
    if (!server || !enableOidcEmailClaims || req.path === '/') {
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'max-age=3600');
    res.json({
      ...authorizationServerMetadata(server),
      subject_types_supported: ['public'],
      claims_supported: ['sub', 'email', 'email_verified'],
    });
  });

  app.use(Object.keys(oauthResources), async (req: Request, res: Response, next: () => void) => {
    // Skip if this is the /mcp/:id route
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    if (mcpCors(req, res)) return;

    // baseUrl is the mount path that matched, e.g. /mcp-oauth-claude
    const { middleware, mcpServer, selfHostedServer } = oauthResources[req.baseUrl];
    const url = new URL(req.baseUrl, process.env.NEXT_PUBLIC_BACKEND_URL);

    const result = await middleware(req, res, url);
    if (!result.proceed) return;

    const token = result.tokenValidation?.subject;
    // a self-hosted connection has no organization here
    const selfHosted = token!.startsWith('psh_');
    const relay = selfHosted ? await resolveSelfHosted(token!) : undefined;
    const { auth, source } = selfHosted
      ? { auth: undefined, source: undefined }
      : await resolveAuthWithSource(token!);
    if (!auth && !(relay && selfHostedServer)) {
      res.status(401).json({ error: 'invalid_token', error_description: 'Could not resolve organization' });
      return;
    }

    // 403, not 401: the token is fine, a 401 would send the client back
    // through OAuth for nothing
    const problem = subscriptionProblem(auth);
    if (problem) {
      res.status(403).json({ error: 'subscription_required', error_description: problem });
      return;
    }

    endListenStream(req, res);
    fixAcceptHeader(req);
    await runWithContext({ requestId: token!, auth, relay: relay || undefined, source }, async () => {
      await (relay ? selfHostedServer! : mcpServer).startHTTP({
        url: url,
        httpPath: url.pathname,
        options: {
          serverless: true,
        },
        req,
        res,
      });
    });
  });

  app.use('/mcp', async (req: Request, res: Response, next: () => void) => {
    // Skip if this is the /mcp/:id route
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    if (mcpCors(req, res)) return;

    const token = extractBearerOrBareToken(req.headers.authorization);
    if (!token) {
      // points OAuth clients at the metadata of this resource (RFC 9728)
      res.setHeader(
        'WWW-Authenticate',
        generateWWWAuthenticateHeader({ resourceMetadataUrl: apiKeyResourceMetadataUrl })
      );
      res.status(401).send('Missing Authorization header');
      return;
    }

    const resolved = await resolveAuthWithSource(token);
    // @ts-ignore
    req.auth = resolved.auth;
    // @ts-ignore
    if (!req.auth) {
      // RFC 6750: a wrong, rotated or revoked key or token
      res.setHeader(
        'WWW-Authenticate',
        generateWWWAuthenticateHeader({
          resourceMetadataUrl: apiKeyResourceMetadataUrl,
          additionalParams: {
            error: 'invalid_token',
            error_description: 'Invalid API Key or OAuth token',
          },
        })
      );
      res.status(401).send('Invalid API Key or OAuth token');
      return;
    }

    // @ts-ignore
    const problem = subscriptionProblem(req.auth);
    if (problem) {
      res.status(403).send(problem);
      return;
    }

    const url = new URL('/mcp', process.env.NEXT_PUBLIC_BACKEND_URL);

    endListenStream(req, res);
    fixAcceptHeader(req);
    // @ts-ignore
    await runWithContext({ requestId: token, auth: req.auth, source: resolved.source }, async () => {
      await server.startHTTP({
        url,
        httpPath: url.pathname,
        options: {
          serverless: true,
        },
        req,
        res,
      });
    });
  });

  app.use('/mcp/:id', async (req: Request, res: Response) => {
    if (mcpCors(req, res)) return;

    // @ts-ignore
    req.auth = await organizationService.getOrgByApiKey(req.params.id);
    // @ts-ignore
    if (!req.auth) {
      res.status(400).send('Invalid API Key');
      return;
    }

    // @ts-ignore
    const problem = subscriptionProblem(req.auth);
    if (problem) {
      res.status(403).send(problem);
      return;
    }

    const url = new URL(
      `/mcp/${req.params.id}`,
      process.env.NEXT_PUBLIC_BACKEND_URL
    );

    endListenStream(req, res);
    fixAcceptHeader(req);
    await runWithContext(
      // @ts-ignore
      { requestId: req.params.id, auth: req.auth, source: 'MCP (API key)' },
      async () => {
        await server.startHTTP({
          url,
          httpPath: url.pathname,
          options: {
            serverless: true,
          },
          req,
          res,
        });
      }
    );
  });

  app.use(['/sse/:id', '/message/:id'], async (req: Request, res: Response) => {
    if (mcpCors(req, res)) return;

    // @ts-ignore
    req.auth = await organizationService.getOrgByApiKey(req.params.id);
    // @ts-ignore
    if (!req.auth) {
      res.status(400).send('Invalid API Key');
      return;
    }

    // @ts-ignore
    const problem = subscriptionProblem(req.auth);
    if (problem) {
      res.status(403).send(problem);
      return;
    }

    const url = new URL(req.originalUrl, process.env.NEXT_PUBLIC_BACKEND_URL);

    await runWithContext(
      // @ts-ignore
      { requestId: req.params.id, auth: req.auth, source: 'MCP (API key)' },
      async () => {
        await new MCPServer(serverConfig).startSSE({
          url,
          ssePath: `/sse/${req.params.id}`,
          messagePath: `/message/${req.params.id}`,
          req,
          res,
        });
      }
    );
  });
};
