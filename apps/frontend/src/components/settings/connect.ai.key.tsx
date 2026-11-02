'use client';

import React, { FC } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

// Where an assistant connected over MCP learns to write for PostDelegate
export const mcpAgentFilesUrl = 'https://postdelegate.com/docs/mcp/agent-files';

// What a workspace without its own AI key sees where AI is needed: the Agent,
// and Studio with its own title and description where AI is an option. With
// "mcp", a second way: Claude or ChatGPT does the AI part over MCP
export const ConnectAiKey: FC<{
  title?: string;
  description?: string;
  mcp?: boolean;
}> = ({ title, description, mcp }) => {
  const t = useT();
  const user = useUser();

  return (
    <div className="bg-newBgColorInner p-[20px] mobile:p-[12px] flex flex-1 flex-col gap-[16px] items-center justify-center text-center">
      <h2 className="text-[20px] font-[500]">
        {title ||
          t('agent_connect_key_title', 'Connect your OpenAI key to start')}
      </h2>
      <div className="text-textItemBlur max-w-[440px]">
        {description ||
          t(
            'agent_connect_key_description',
            'The Agent runs on your own OpenAI account, so usage is billed to you by OpenAI, not by PostDelegate.'
          )}
      </div>
      {user?.role !== 'USER' ? (
        <Link
          href="/settings?tab=ai"
          className="text-btnCtaText font-[600] whitespace-nowrap pt-[12px] pb-[14px] ps-[16px] pe-[20px] min-h-[44px] rounded-[10px] bg-btnCta shadow-cta hover:bg-btnCtaHover transition-colors flex justify-center items-center outline-none"
        >
          {t('agent_connect_key_button', 'Add your OpenAI key')}
        </Link>
      ) : (
        <div className="text-[14px]">
          {t(
            'agent_connect_key_ask_admin',
            'Ask your workspace admin to add a key'
          )}
        </div>
      )}
      {mcp && (
        <a
          href={mcpAgentFilesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-btnText font-[600] whitespace-nowrap px-[16px] min-h-[44px] rounded-[10px] bg-btnSimple hover:bg-boxHover transition-colors flex justify-center items-center gap-[8px] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
        >
          {t('connect_ai_use_mcp', 'Use it from Claude/ChatGPT via MCP')}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      )}
    </div>
  );
};
