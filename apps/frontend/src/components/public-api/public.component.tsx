'use client';

import { FC, useState, useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { useUser } from '../layout/user.context';
import copy from 'copy-to-clipboard';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import { McpClientIcon } from '@gitroom/frontend/components/public-api/mcp.client.icons';
import clsx from 'clsx';

// Remote clients can't set headers, they get a URL to paste (hint = where)
export const remoteMcpClients = {
  Claude:
    'In Claude go to Settings > Connectors > Add custom connector and paste this URL.',
  ChatGPT:
    'In ChatGPT turn on Developer mode (Settings > Apps & Connectors > Advanced), then click Create and paste this URL.',
} as const;

export const mcpClients = [
  'OpenClaw',
  'Hermes',
  'NanoClaw',
  'Claude Code',
  'Cursor',
  'Codex',
  'VS Code / Copilot',
  'Windsurf',
  'Amp',
  'Gemini CLI',
  'Warp',
] as const;

export type RemoteMcpClient = keyof typeof remoteMcpClients;
export type McpClient = (typeof mcpClients)[number];
export type AnyMcpClient = RemoteMcpClient | McpClient;

// oauth: no API key, the client registers itself (DCR) and the user signs in to PostDelegate
// apikey: the organization API key, as a Bearer header (or inside the URL for remote clients)
export type McpAuth = 'oauth' | 'apikey';

// The OAuth-protected MCP endpoint. The backend advertises it (resource and
// issuer metadata) at the root of its origin, whatever path prefix the API is
// served under, so the URL is built from the origin of the configured URL.
export const getMcpOauthUrl = (mcpBase: string) => {
  try {
    return `${new URL(mcpBase).origin}/mcp-oauth-dynamic`;
  } catch (err) {
    return `${mcpBase}/mcp-oauth-dynamic`;
  }
};

export const isRemoteMcpClient = (client: string): client is RemoteMcpClient =>
  client in remoteMcpClients;

export const getMcpConfig = (
  client: AnyMcpClient,
  auth: McpAuth,
  mcpBase: string,
  apiKey: string
): { config: string; hint: string } => {
  if (isRemoteMcpClient(client)) {
    return {
      config:
        auth === 'oauth' ? getMcpOauthUrl(mcpBase) : `${mcpBase}/mcp/${apiKey}`,
      hint: remoteMcpClients[client],
    };
  }

  const oauthUrl = getMcpOauthUrl(mcpBase);
  const urlBase = `${mcpBase}/mcp`;
  const bearer = `Bearer ${apiKey}`;

  const json = (obj: object) => JSON.stringify(obj, null, 2);

  if (auth === 'oauth') {
    switch (client) {
      case 'Claude Code':
        return {
          config: `claude mcp add --transport http postdelegate ${oauthUrl}`,
          hint: 'Run this command in your terminal.',
        };
      case 'Cursor':
        return {
          config: json({ mcpServers: { postdelegate: { url: oauthUrl } } }),
          hint: 'Add to .cursor/mcp.json in your project root.',
        };
      case 'VS Code / Copilot':
        return {
          config: json({
            servers: { postdelegate: { type: 'http', url: oauthUrl } },
          }),
          hint: 'Add to .vscode/mcp.json in your project root.',
        };
      case 'Windsurf':
        return {
          config: json({
            mcpServers: { postdelegate: { serverUrl: oauthUrl } },
          }),
          hint: 'Add to ~/.codeium/windsurf/mcp_config.json',
        };
      case 'Amp':
        return {
          config: `amp mcp add postdelegate ${oauthUrl}`,
          hint: 'Run this command in your terminal.',
        };
      case 'Codex':
        return {
          config: `# ~/.codex/config.toml\n\n[mcp_servers.postdelegate]\nurl = "${oauthUrl}"`,
          hint: 'Add to ~/.codex/config.toml, then run: codex mcp login postdelegate',
        };
      case 'Gemini CLI':
        return {
          config: json({ mcpServers: { postdelegate: { url: oauthUrl } } }),
          hint: 'Add to ~/.gemini/settings.json',
        };
      case 'Warp':
        return {
          config: json({ postdelegate: { url: oauthUrl } }),
          hint: 'Settings > MCP Servers > + Add, then paste this config.',
        };
      case 'Hermes':
        return {
          config: `# ~/.hermes/config.yaml\n\nmcp_servers:\n  postdelegate:\n    url: "${oauthUrl}"\n    auth: oauth`,
          hint: 'Add to ~/.hermes/config.yaml, then run /reload-mcp in the chat.',
        };
      case 'OpenClaw':
        return {
          config: `openclaw mcp add postdelegate --url ${oauthUrl} --transport streamable-http --auth oauth && openclaw mcp login postdelegate`,
          hint: 'Run this command in your terminal.',
        };
      case 'NanoClaw':
        return {
          config: `ncl groups config add-mcp-server --id <group-id> --name postdelegate --url ${oauthUrl}`,
          hint: 'Run this in your terminal, replace <group-id> with the agent group that should get PostDelegate.',
        };
    }
  }

  switch (client) {
    case 'Claude Code':
      return {
        config: `claude mcp add --transport http postdelegate ${urlBase} --header "Authorization: ${bearer}"`,
        hint: 'Run this command in your terminal.',
      };
    case 'Cursor':
      return {
        config: json({
          mcpServers: {
            postdelegate: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to .cursor/mcp.json in your project root.',
      };
    case 'VS Code / Copilot':
      return {
        config: json({
          servers: {
            postdelegate: {
              type: 'http',
              url: urlBase,
              headers: { Authorization: bearer },
            },
          },
        }),
        hint: 'Add to .vscode/mcp.json in your project root.',
      };
    case 'Windsurf':
      return {
        config: json({
          mcpServers: {
            postdelegate: {
              serverUrl: urlBase,
              headers: { Authorization: bearer },
            },
          },
        }),
        hint: 'Add to ~/.codeium/windsurf/mcp_config.json',
      };
    case 'Amp':
      return {
        config: json({
          'amp.mcpServers': {
            postdelegate: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to your Amp settings.json',
      };
    case 'Codex':
      return {
        config: `# ~/.codex/config.toml\n\n[mcp_servers.postdelegate]\nurl = "${urlBase}"\nhttp_headers = { "Authorization" = "${bearer}" }`,
        hint: 'Add to ~/.codex/config.toml',
      };
    case 'Gemini CLI':
      return {
        config: json({
          mcpServers: {
            postdelegate: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to ~/.gemini/settings.json',
      };
    case 'Warp':
      return {
        config: json({
          postdelegate: { url: urlBase, headers: { Authorization: bearer } },
        }),
        hint: 'Settings > MCP Servers > + Add, then paste this config.',
      };
    case 'Hermes':
      return {
        config: `# ~/.hermes/config.yaml\n\nmcp_servers:\n  postdelegate:\n    url: "${urlBase}"\n    headers:\n      Authorization: "${bearer}"`,
        hint: 'Add to ~/.hermes/config.yaml, then run /reload-mcp in the chat.',
      };
    case 'OpenClaw':
      return {
        config: json({
          mcp: {
            servers: {
              postdelegate: {
                url: urlBase,
                transport: 'streamable-http',
                headers: { Authorization: bearer },
              },
            },
          },
        }),
        hint: 'Add to ~/.openclaw/openclaw.json',
      };
    case 'NanoClaw':
      // No headers flag, the key travels inside the URL like remote clients
      return {
        config: `ncl groups config add-mcp-server --id <group-id> --name postdelegate --url ${mcpBase}/mcp/${apiKey}`,
        hint: 'Run this in your terminal, replace <group-id> with the agent group that should get PostDelegate.',
      };
  }
};

export const CopyButton = ({
  text,
  label,
}: {
  text: string;
  label: string;
}) => {
  const toaster = useToaster();
  return (
    <button
      type="button"
      onClick={() => {
        copy(text);
        toaster.show(`${label} copied to clipboard`, 'success');
      }}
      className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
      </svg>
      {label}
    </button>
  );
};

export const mcpDocsUrl = 'https://postdelegate.com/docs/mcp';

// The tabs of "Connect your AI", every one of them signs in with OAuth, the
// assistant registers itself and the user approves access in PostDelegate
const connectAiTabs = ['Claude', 'ChatGPT', 'Claude Code', 'other'] as const;
type ConnectAiTab = (typeof connectAiTabs)[number];

// Claude Code has its own tab, the rest share the "other" tab with a picker
const connectAiOtherClients = mcpClients.filter(
  (client) => client !== 'Claude Code'
);

export const ConnectAiSection: FC = () => {
  const t = useT();
  const { backendUrl, mcpUrl } = useVariables();
  const [tab, setTab] = useState<ConnectAiTab>('Claude');
  const [otherClient, setOtherClient] = useState<McpClient>(
    connectAiOtherClients[0]
  );

  const oauthUrl = getMcpOauthUrl(mcpUrl || backendUrl);

  // Claude Code and the other tools take a config, Claude and ChatGPT a URL
  const snippet =
    tab === 'Claude Code'
      ? getMcpConfig('Claude Code', 'oauth', mcpUrl || backendUrl, '')
      : tab === 'other'
      ? getMcpConfig(otherClient, 'oauth', mcpUrl || backendUrl, '')
      : undefined;

  const steps: Record<ConnectAiTab, string[]> = {
    Claude: [
      t(
        'connect_claude_step_1',
        'Open Claude (claude.ai or the desktop app) and go to Settings > Connectors.'
      ),
      t('connect_claude_step_2', 'Click "Add custom connector".'),
      t(
        'connect_claude_step_3',
        'Enter "PostDelegate" as the name and paste the MCP server URL from above.'
      ),
      t(
        'connect_claude_step_4',
        'Click "Add", then click "Connect" next to PostDelegate.'
      ),
      t(
        'connect_sign_in_step',
        'Sign in to PostDelegate when asked and approve access.'
      ),
    ],
    ChatGPT: [
      t(
        'connect_chatgpt_step_1',
        'In ChatGPT open Settings > Apps & Connectors > Advanced settings and turn on Developer mode.'
      ),
      t(
        'connect_chatgpt_step_2',
        'Go back to Apps & Connectors and click "Create".'
      ),
      t(
        'connect_chatgpt_step_3',
        'Enter "PostDelegate" as the name and paste the MCP server URL from above.'
      ),
      t(
        'connect_chatgpt_step_4',
        'Set the authentication to OAuth and click "Create".'
      ),
      t(
        'connect_sign_in_step',
        'Sign in to PostDelegate when asked and approve access.'
      ),
    ],
    'Claude Code': [
      t(
        'connect_code_step_1',
        'Run the command above in your terminal.'
      ),
      t(
        'connect_code_step_2',
        'Start Claude Code, type /mcp, choose postdelegate and select "Authenticate".'
      ),
      t(
        'connect_sign_in_step',
        'Sign in to PostDelegate when asked and approve access.'
      ),
    ],
    other: [
      t(
        'connect_other_step_1',
        'Add the configuration above to your tool, the line above it says where it goes.'
      ),
      t(
        'connect_other_step_2',
        'Restart or reload the tool so it picks up the new MCP server.'
      ),
      t(
        'connect_sign_in_step',
        'Sign in to PostDelegate when asked and approve access.'
      ),
    ],
  };

  const notes: Partial<Record<ConnectAiTab, string>> = {
    Claude: t(
      'connect_claude_note',
      'On Team and Enterprise plans an owner first adds the connector under Organization settings > Connectors.'
    ),
    ChatGPT: t(
      'connect_chatgpt_note',
      'Developer mode is not available on every ChatGPT plan.'
    ),
  };

  return (
    <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
      <div className="bg-newBgColorInner px-[20px] mobile:px-[14px] py-[14px] border-b border-newBorder">
        <div className="text-[15px] font-[600]">
          {t('connect_your_ai', 'Connect your AI')}
        </div>
        <div className="text-[13px] text-textItemBlur mt-[2px]">
          {t(
            'connect_your_ai_description',
            'Use your own Claude, ChatGPT or coding assistant to create and schedule posts. Add PostDelegate as a custom connector, sign in and approve access, no API key needed.'
          )}
        </div>
      </div>
      <div className="p-[20px] mobile:p-[14px] flex flex-col gap-[16px]">
        <div className="flex flex-wrap gap-[6px]">
          {connectAiTabs.map((item) => (
            <button
              key={item}
              type="button"
              className={clsx(
                'cursor-pointer px-[14px] h-[36px] text-[13px] font-[500] rounded-[8px] transition-colors flex items-center gap-[8px]',
                tab === item
                  ? 'bg-btnPrimary text-white'
                  : 'bg-btnSimple text-textItemBlur hover:bg-boxHover hover:text-textColor'
              )}
              onClick={() => setTab(item)}
            >
              <McpClientIcon client={item === 'other' ? 'Cursor' : item} />
              {item === 'other'
                ? t('connect_tab_other', 'Cursor / VS Code / other')
                : item}
            </button>
          ))}
        </div>
        {tab === 'other' && (
          <div className="flex flex-wrap gap-[6px]">
            {connectAiOtherClients.map((client) => (
              <button
                key={client}
                type="button"
                className={clsx(
                  'cursor-pointer px-[12px] h-[32px] text-[12px] font-[500] rounded-[8px] transition-colors flex items-center gap-[6px]',
                  otherClient === client
                    ? 'bg-btnPrimary text-white'
                    : 'bg-btnSimple text-textItemBlur hover:bg-boxHover hover:text-textColor'
                )}
                onClick={() => setOtherClient(client)}
              >
                <McpClientIcon client={client} size={14} />
                {client}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-[6px]">
          <div className="text-[13px] font-[600] text-textItemBlur">
            {t('mcp_server_url', 'MCP server URL')}
          </div>
          <div className="flex flex-wrap items-center gap-[8px]">
            <code className="bg-newBgColorInner border border-newBorder rounded-[8px] px-[16px] min-h-[36px] py-[8px] flex items-center text-[13px] break-all">
              {oauthUrl}
            </code>
            <CopyButton text={oauthUrl} label={t('copy_url', 'Copy URL')} />
          </div>
        </div>
        {!!snippet && (
          <div className="flex flex-col gap-[6px]">
            <div className="text-[12px] text-textItemBlur font-[500]">
              {snippet.hint}
            </div>
            <pre className="bg-newBgColorInner border border-newBorder rounded-[8px] p-[16px] text-[13px] whitespace-pre-wrap break-all overflow-x-auto leading-[1.6]">
              {snippet.config}
            </pre>
            <div className="flex flex-wrap gap-[8px]">
              <CopyButton
                text={snippet.config}
                label={t('copy', 'Copy')}
              />
            </div>
          </div>
        )}
        <ol className="flex flex-col gap-[10px]">
          {steps[tab].map((step, index) => (
            <li key={index} className="flex items-start gap-[10px]">
              <span className="shrink-0 w-[22px] h-[22px] rounded-full bg-btnSimple text-[12px] font-[600] flex items-center justify-center">
                {index + 1}
              </span>
              <span className="text-[14px] leading-[22px]">{step}</span>
            </li>
          ))}
        </ol>
        {!!notes[tab] && (
          <div className="text-[13px] text-textItemBlur">{notes[tab]}</div>
        )}
        <div>
          <a
            href={mcpDocsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-[600] text-btnPrimary hover:underline"
          >
            {t('connect_read_guide', 'Read the full setup guide')}
          </a>
        </div>
      </div>
    </div>
  );
};

// MCP clients that can't sign in with OAuth, or that you want to run without
// a browser, connect with the organization API key instead
const McpSection = ({
  user,
  mcpBase,
}: {
  user: { publicApi: string };
  mcpBase: string;
}) => {
  const t = useT();
  const [activeClient, setActiveClient] = useState<AnyMcpClient>('Claude Code');
  const [revealed, setRevealed] = useState(false);

  const { config, hint } = getMcpConfig(
    activeClient,
    'apikey',
    mcpBase,
    user.publicApi
  );

  const baseUrl = `${mcpBase}/mcp`;

  const maskedConfig = revealed
    ? config
    : config.replace(
        new RegExp(user.publicApi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        '*'.repeat(user.publicApi.length)
      );

  return (
    <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
      <div className="bg-newBgColorInner px-[20px] mobile:px-[14px] py-[14px] border-b border-newBorder flex items-start justify-between gap-[12px] mobile:flex-col">
        <div>
          <div className="text-[15px] font-[600]">
            {t('mcp_api_key_configuration', 'MCP with an API key')}
          </div>
          <div className="text-[13px] text-textItemBlur mt-[2px]">
            {t(
              'mcp_api_key_description',
              'Prefer a key over signing in? Connect any MCP client (HTTP streaming) with your API key.'
            )}
          </div>
        </div>
      </div>
      <div className="p-[20px] mobile:p-[14px] flex flex-col gap-[16px]">
        <div className="flex flex-col gap-[6px]">
          <div className="text-[13px] font-[600] text-textItemBlur">
            {t('mcp_client', 'Client')}
          </div>
          <div className="flex flex-wrap gap-[6px]">
            {[...Object.keys(remoteMcpClients), ...mcpClients].map((client) => (
              <button
                key={client}
                type="button"
                className={clsx(
                  'cursor-pointer px-[14px] h-[36px] text-[13px] font-[500] rounded-[8px] transition-colors flex items-center gap-[8px]',
                  activeClient === client
                    ? 'bg-btnPrimary text-white'
                    : 'bg-btnSimple text-textItemBlur hover:bg-boxHover hover:text-textColor'
                )}
                onClick={() => setActiveClient(client as AnyMcpClient)}
              >
                <McpClientIcon client={client} />
                {client}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-[8px]">
          <div className="text-[12px] text-textItemBlur font-[500]">{hint}</div>
          <pre className="bg-newBgColorInner border border-newBorder rounded-[8px] p-[16px] text-[13px] whitespace-pre-wrap break-all overflow-x-auto leading-[1.6]">
            {maskedConfig}
          </pre>
          <div className="flex flex-wrap gap-[8px]">
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {revealed ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
              {revealed ? t('hide', 'Hide') : t('reveal', 'Reveal')}
            </button>
            <CopyButton text={config} label={t('copy', 'Copy')} />
            {!isRemoteMcpClient(activeClient) && (
              <CopyButton text={baseUrl} label={t('copy_url', 'Copy URL')} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const PublicApiContent = () => {
  const user = useUser();
  const { backendUrl, frontEndUrl, mcpUrl } = useVariables();
  const toaster = useToaster();
  const fetch = useFetch();
  const decision = useDecisionModal();
  const { mutate } = useSWRConfig();
  const [reveal, setReveal] = useState(false);
  const t = useT();

  const rotateKey = useCallback(async () => {
    const approved = await decision.open({
      title: t('rotate_api_key', 'Rotate API Key?'),
      description: t(
        'rotate_api_key_description',
        'This will generate a new API key and invalidate the current one. Any integrations using the old key will stop working.'
      ),
      approveLabel: t('rotate', 'Rotate'),
      cancelLabel: t('cancel', 'Cancel'),
    });
    if (!approved) return;
    await fetch('/user/api-key/rotate', { method: 'POST' });
    await mutate('/user/self');
    setReveal(false);
    toaster.show(
      t('api_key_rotated', 'API Key rotated successfully'),
      'success'
    );
  }, [decision, fetch, mutate, toaster]);

  if (!user || !user.publicApi) {
    return null;
  }

  const mcpBase = mcpUrl || backendUrl;
  const apiBase = `${backendUrl}/public/v1`;

  return (
    <div className="flex flex-col gap-[40px]">
      <ConnectAiSection />
      <div className="text-[14px] text-textColor leading-[1.7]">
        {t(
          'api_auth_note_line1',
          'Use your API Key to automate your own account.'
        )}
        <br />
        {t(
          'api_auth_note_line2',
          'If you are building a product that schedules posts on behalf of other PostDelegate users,'
        )}
        <br />
        {t(
          'api_auth_note_line3',
          'create an OAuth App under the "Apps" tab. Your users will authorize your app via OAuth2,'
        )}
        <br />
        {t(
          'api_auth_note_line4',
          'and you will receive a pos_ prefixed token that works with the API and MCP — just like an API Key.'
        )}
      </div>
      <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
        <div className="bg-newBgColorInner px-[20px] mobile:px-[14px] py-[14px] border-b border-newBorder flex items-start justify-between gap-[12px] mobile:flex-col">
          <div>
            <div className="text-[15px] font-[600]">
              {t('api_key', 'API Key')}
            </div>
            <div className="text-[13px] text-customColor18 mt-[2px]">
              {t(
                'use_postiz_api_to_integrate_with_your_tools',
                'Use PostDelegate API to integrate with your tools.'
              )}
            </div>
          </div>
        </div>
        <div className="p-[20px] mobile:p-[14px] flex flex-col gap-[16px]">
          <div className="flex flex-col gap-[6px]">
            <div className="text-[13px] font-[600] text-customColor18">
              {t('api_base_url', 'API base URL')}
            </div>
            <div className="flex flex-wrap items-center gap-[8px]">
              <code className="bg-newBgColorInner border border-newBorder rounded-[8px] px-[16px] h-[36px] flex items-center text-[13px] break-all">
                {apiBase}
              </code>
              <CopyButton text={apiBase} label={t('copy_url', 'Copy URL')} />
            </div>
          </div>
          <div className="bg-newBgColorInner border border-newBorder rounded-[8px] px-[16px] h-[44px] flex items-center overflow-hidden">
            <code className="text-[14px] flex-1 truncate">
              {reveal ? (
                user.publicApi
              ) : (
                <span className="flex items-center">
                  <span className="blur-sm select-none">
                    {user.publicApi.slice(0, -5)}
                  </span>
                  <span>{user.publicApi.slice(-5)}</span>
                </span>
              )}
            </code>
          </div>
          <div className="flex flex-wrap gap-[8px]">
            <button
              type="button"
              onClick={() => setReveal(!reveal)}
              className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {reveal ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
              {reveal ? t('hide', 'Hide') : t('reveal', 'Reveal')}
            </button>
            <CopyButton text={user.publicApi} label={t('copy', 'Copy')} />
            <button
              type="button"
              onClick={rotateKey}
              className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6" />
                <path d="M21.34 15.57a10 10 0 11-.57-8.38L21.5 8" />
              </svg>
              {t('rotate_key', 'Rotate Key')}
            </button>
            <button
              type="button"
              data-tooltip-id="tooltip"
              data-tooltip-content={t(
                'payload_wizard_description',
                'Building a POST request to /posts can be complex. Use the wizard to schedule a post with the UI, then copy the generated payload.'
              )}
              onClick={() =>
                window.open(`${frontEndUrl}/modal/dark/all`, '_blank')
              }
              className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {t('open_wizard', 'Open Wizard')}
            </button>
          </div>
        </div>
      </div>

      <McpSection user={user} mcpBase={mcpBase} />
    </div>
  );
};

export const PublicComponent = () => {
  const t = useT();

  return (
    <div className="flex flex-col gap-[20px]">
      <h3 className="text-[20px]">{t('agents', 'Agents')}</h3>
      <PublicApiContent />
    </div>
  );
};
