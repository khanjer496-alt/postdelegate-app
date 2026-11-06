import type { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// The postdelegate agent as an MCP tool. MCPServer's own `agents` option turns
// it into an ask_postdelegate tool with no annotations and no output schema,
// which directory reviews flag, so the API key server registers it as a
// regular tool under the same name instead. It needs the built agent, so it
// is not one of the toolList classes (which the agent itself is built from)
export const ASK_AGENT_TOOL_NAME = 'ask_postdelegate';

export const askAgentTool = (agent: Agent) =>
  createTool({
    id: ASK_AGENT_TOOL_NAME,
    description: `Ask agent '${agent.name}' a question. Agent description: ${agent.getDescription()}
                  It runs on the workspace's own OpenAI key (Settings → AI) and can schedule, change and delete posts after asking for confirmation.`,
    mcp: {
      annotations: {
        title: 'Ask the PostDelegate Agent',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    inputSchema: z.object({
      message: z.string().describe('The question or input for the agent.'),
    }),
    outputSchema: z.object({
      text: z.string(),
    }),
    // no checkAuth here: it marks the request context ui='false', which the
    // agent instructions read as an app with a post modal. The agent model and
    // its tools find the organization in the MCP auth context
    execute: async (inputData, context) => {
      const result = await agent.generate(inputData.message, {
        requestContext: context?.requestContext,
      });

      return { text: result.text };
    },
  });
