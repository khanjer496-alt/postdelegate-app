import type { APIRoute } from 'astro';
import { SITE } from '../data/site';
import { DOC_SECTIONS } from '../data/docs';
import { AVAILABLE_NETWORKS } from '../data/networks';
import { PLANS, TRIAL_DAYS } from '../data/plans';
export const GET: APIRoute = () => {
  const live = AVAILABLE_NETWORKS.map((network) => network.name).join(', ');
  const body = `# PostDelegate

> A social media scheduler with one visual calendar, operated independently by ${SITE.operator}.

## Current stage
- PostDelegate is in early access. Start a 7-day free trial, no credit card needed, at ${SITE.signup}.
- The workspace includes a calendar, composer, media library and publishing workflow.
- Content Studio turns a video from the media library into a vertical 1080×1920 MP4 of up to 90 seconds, with a hook line (Hook over clip) or burned-in captions that light up word by word (Talking head + captions). Captions come from the workspace's own OpenAI key (Whisper, billed by OpenAI) or from a typed script. Studio edits the customer's own clips; it does not generate AI video. Included on every paid plan with fair use; the free trial includes 10 videos. Guide: ${SITE.url}/docs/studio.
- Bulk video scheduling takes up to 50 videos at a time and spreads them over each channel's posting time slots, or one every few hours or days, with a preview of every date before anything is scheduled. Posts can also be imported from a CSV file, up to 200 per file. Guide: ${SITE.url}/docs/bulk-import.
- Social channel connections are in rollout. A provider in the source or on a platform page is not a promise of a live hosted connection.
- Google sign-in is separate from connecting a social publishing account.
- Plans: Starter $19, Team $29, Pro $39 and Ultimate $79 per month ($180, $276, $372 and $756 per year, US dollars). Every plan starts with a 7-day free trial that needs no credit card. Add a card any time before the trial ends to keep the plan; the first payment is taken when the trial ends. If the trial ends without a card, the workspace is paused until a plan is chosen; posts are kept, and channels and team members are switched back on when subscribing to a plan that includes them. One free trial per email address. Details at ${SITE.url}/pricing and ${SITE.url}/docs/billing.
- The main marketing pages (home, pricing, platforms, AI and developer pages, compare and alternatives hubs, about, support and the live network pages) are also published in Spanish, Portuguese, German, French, Arabic and Italian under ${SITE.url}/es, /pt, /de, /fr, /ar and /it. Documentation, guides and legal pages are English only.
- Documentation is at ${SITE.url}/docs. The REST API base is https://app.postdelegate.com/api/public/v1 (OpenAPI spec: ${SITE.url}/openapi.json) and the MCP server is https://app.postdelegate.com/mcp-oauth-dynamic. PostDelegate has no official marketplace listing in Claude or ChatGPT; assistants are added as custom connectors.
- AI writing, the Agent and AI images inside the app run on the workspace's own OpenAI API key, added by an admin in Settings → AI. The customer pays OpenAI directly; PostDelegate never charges for AI. AI video is not available. Customers can also bring their own AI assistant, such as ChatGPT or Claude, through MCP.
- Connectable channels today: YouTube, Bluesky, DEV.to, Hashnode, Lemmy, Listmonk, Medium, Nostr, WordPress, Kick, Twitch, Tumblr, Dribbble, Slack, Telegram, Discord, Mastodon and Google Business Profile. Facebook, Instagram, Threads, TikTok, LinkedIn, Pinterest and Reddit are waiting on platform approval. X is not available on PostDelegate.
- Application source code (AGPL-3.0): ${SITE.source}. License details: ${SITE.url}/licenses.

## When to use PostDelegate
- You want an AI assistant (Claude, ChatGPT, Cursor, Claude Code, Codex) to draft and schedule posts through MCP, with drafts held for a person to approve.
- You publish to networks that connect today: ${live}.
- You want flat pricing by channel count (from $${PLANS[0].monthly}/month after a ${TRIAL_DAYS}-day free trial, no card) and the REST API, MCP and webhooks on every plan.
- You want to bring your own AI: your own OpenAI key or assistant, with no AI markup or credit allowance.
- You need client approval links that need no account, bulk video scheduling or CSV import.

## When not to use PostDelegate
- Your main channel is Instagram, Facebook, Threads, TikTok or LinkedIn, which are waiting on platform approval and cannot be connected yet, or X, which is not available on PostDelegate.
- You want AI credits included in the plan, or AI video generation. PostDelegate does neither.
- You need a shared social inbox for replies and messages, or social listening.
- You need it at no cost for good. There is a ${TRIAL_DAYS}-day trial with no card, then a paid plan.
- You want to run the software on your own server. PostDelegate is hosted; a self-hosted tool such as Postiz or Mixpost suits that better.

## Connect over MCP (copy and paste)
Server address (sign in with PostDelegate, OAuth): https://app.postdelegate.com/mcp-oauth-dynamic
With an API key instead: https://app.postdelegate.com/api/mcp and the header "Authorization: Bearer YOUR_API_KEY". Full setup: ${SITE.url}/docs/mcp/clients

Claude Code:
\`\`\`bash
claude mcp add --transport http postdelegate https://app.postdelegate.com/mcp-oauth-dynamic
\`\`\`
Then run /mcp inside Claude Code and authenticate the postdelegate server.

Cursor (.cursor/mcp.json):
\`\`\`json
{
  "mcpServers": {
    "postdelegate": {
      "url": "https://app.postdelegate.com/mcp-oauth-dynamic"
    }
  }
}
\`\`\`

Claude Desktop: the simplest route is Settings > Connectors > Add custom connector with the server address above (${SITE.url}/docs/mcp/claude). To use claude_desktop_config.json instead, bridge the remote server with mcp-remote (needs Node.js):
\`\`\`json
{
  "mcpServers": {
    "postdelegate": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://app.postdelegate.com/mcp-oauth-dynamic"]
    }
  }
}
\`\`\`

## Documentation
Each link below is the page's Markdown version. Every docs page has one at its URL plus \`.md\`, and docs pages also return Markdown to requests that send \`Accept: text/markdown\`.
- [Documentation home](${SITE.url}/docs.md): every docs page by section.
${DOC_SECTIONS.flatMap((section) => section.items).map((item) => `- [${item.title}](${SITE.url}${item.href}.md): ${item.description}`).join('\n')}

## Agent instruction files
- [Claude skill (SKILL.md)](${SITE.url}/agents/postdelegate/SKILL.md): how to use PostDelegate over MCP or the REST API, with per-network rules and safety rules.
- [Claude skill (zip for claude.ai)](${SITE.url}/agents/postdelegate-skill.zip)
- [AGENTS.md for coding agents](${SITE.url}/agents/AGENTS.md): REST API and MCP guidance for Codex, Cursor, Claude Code and others.
- [ChatGPT instructions](${SITE.url}/agents/chatgpt-instructions.md): paste into a custom GPT or Project that uses the PostDelegate connector.
- [Cursor rule](${SITE.url}/agents/postdelegate.mdc)
- [How to install them](${SITE.url}/docs/mcp/agent-files)

## Pages
- [Product facts](${SITE.url}/llms-full.txt)
- [Plans and pricing](${SITE.url}/pricing)
- [Platform rollout](${SITE.url}/platforms)
- [Agents and automation](${SITE.url}/agents)
- [REST API](${SITE.url}/api)
- [REST API OpenAPI 3.1 spec](${SITE.url}/openapi.json)
- [MCP](${SITE.url}/mcp)
- [Compare PostDelegate with other schedulers](${SITE.url}/compare)
- [Changelog](${SITE.url}/changelog)
- [Roadmap: networks in review](${SITE.url}/roadmap)
- [Every page (sitemap.md)](${SITE.url}/sitemap.md)
- [Browser-based tools](${SITE.url}/tools)
- [Support](${SITE.url}/support)
- [Privacy](${SITE.legal.privacy})
- [Terms](${SITE.legal.terms})
- [Data Processing Addendum](${SITE.legal.dpa})
- [Sub-processors](${SITE.legal.subprocessors})
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
