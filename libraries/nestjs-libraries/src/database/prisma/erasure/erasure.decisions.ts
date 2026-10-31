// One entry per model in schema.prisma, explaining what the permanent erasure
// does with it. erasure.decisions.spec.ts fails when a model is added to the
// schema without a decision here, so a new table cannot silently escape an
// erasure request.
export type ErasureScope =
  // hard-deleted together with an organization that only the person belonged to
  | 'org'
  // hard-deleted (or detached) for the person, also in shared organizations
  | 'user'
  // removed with the organization AND for the person
  | 'org+user'
  // financial record that is kept without personal data
  | 'retain'
  // global, holds no tenant or personal data
  | 'none';

export interface ErasureDecision {
  scope: ErasureScope;
  note: string;
}

const AI_MEMORY =
  'Mastra chat memory, keyed by resourceId = organization id; erased after the database commit, tolerating a missing table';
const FRAMEWORK =
  'Mastra framework table, Postiz never writes a tenant key to it; untouched';

export const ERASURE_DECISIONS: Record<string, ErasureDecision> = {
  Organization: {
    scope: 'org',
    note: 'row deleted last; apiKey, paymentId and the affiliate referral fields (referredByAffiliateId, referralCode, referredAt, referralFirstPaidAt) go with it',
  },
  Tags: { scope: 'org', note: 'deleted' },
  TagsPosts: { scope: 'org', note: 'deleted before posts and tags' },
  User: {
    scope: 'user',
    note: 'row deleted; replaced by an anonymised tombstone only when the person has an affiliate commission ledger that must keep its foreign key',
  },
  UsedCodes: { scope: 'org', note: 'deleted' },
  UserOrganization: {
    scope: 'org+user',
    note: 'every membership row of an erased organization, and the person membership in shared organizations',
  },
  GitHub: { scope: 'org', note: 'deleted, holds an access token' },
  Trending: { scope: 'none', note: 'global trending cache' },
  TrendingLog: { scope: 'none', note: 'global trending log' },
  ItemUser: { scope: 'user', note: 'deleted' },
  Star: { scope: 'none', note: 'public GitHub star statistics' },
  Media: {
    scope: 'org',
    note: 'rows deleted, the R2 objects named by path and thumbnail are deleted after the commit; a personal avatar uploaded into a shared organization is deleted too',
  },
  SocialMediaAgency: {
    scope: 'user',
    note: 'deleted, together with its logo Media row and object',
  },
  SocialMediaAgencyNiche: { scope: 'user', note: 'deleted with the agency' },
  Credits: { scope: 'org', note: 'deleted' },
  Clipping: { scope: 'org', note: 'deleted' },
  ClippingClip: { scope: 'org', note: 'deleted, clip files are R2 objects' },
  Subscription: {
    scope: 'org',
    note: 'row deleted after the Stripe subscription is cancelled; Stripe keeps its own customer and invoice records (tax law), the customer id is listed in the receipt for the operator',
  },
  Customer: { scope: 'org', note: 'deleted after the integrations' },
  Integration: {
    scope: 'org',
    note: 'deleted with token, refreshToken, customInstanceDetails and profile; refused while a provider authorization (for example YouTube) is not yet revoked',
  },
  Signatures: { scope: 'org', note: 'deleted' },
  Comments: {
    scope: 'org+user',
    note: 'deleted with an erased organization; in shared organizations the comments stay but userId and displayName are removed',
  },
  Post: {
    scope: 'org',
    note: 'deleted (also soft-deleted and published rows); parent links are cleared first; posts already published on a social network stay there',
  },
  Notifications: { scope: 'org', note: 'deleted' },
  MessagesGroup: {
    scope: 'org+user',
    note: 'legacy marketplace, deleted for the organization buyer and for either user',
  },
  PayoutProblems: { scope: 'org+user', note: 'legacy marketplace, deleted' },
  Orders: { scope: 'org+user', note: 'legacy marketplace, deleted' },
  OrderItems: { scope: 'org+user', note: 'legacy marketplace, deleted' },
  Messages: { scope: 'org+user', note: 'legacy marketplace, deleted' },
  Plugs: { scope: 'org', note: 'deleted' },
  ExisingPlugData: { scope: 'org', note: 'deleted' },
  PopularPosts: { scope: 'none', note: 'global content library' },
  IntegrationsWebhooks: { scope: 'org', note: 'deleted' },
  Webhooks: { scope: 'org', note: 'deleted, the URL may identify a person' },
  AutoPost: { scope: 'org', note: 'deleted' },
  Sets: { scope: 'org', note: 'deleted' },
  Idea: {
    scope: 'org',
    note: 'deleted before tags; createdById is a plain id with no relation, gone with the row',
  },
  PostImport: { scope: 'org', note: 'deleted, holds import results only' },
  ThirdParty: { scope: 'org', note: 'deleted, holds a third party API key' },
  AiCredential: { scope: 'org', note: 'deleted, holds the workspace OpenAI key' },
  Errors: { scope: 'org', note: 'deleted, bodies can hold post content' },
  Mentions: { scope: 'none', note: 'global cache of public social handles' },
  mastra_messages: { scope: 'org', note: AI_MEMORY },
  mastra_threads: { scope: 'org', note: AI_MEMORY },
  mastra_thread_state: { scope: 'org', note: AI_MEMORY },
  mastra_resources: { scope: 'org', note: AI_MEMORY },
  mastra_workflow_snapshot: { scope: 'org', note: AI_MEMORY },
  mastra_scorers: { scope: 'org', note: AI_MEMORY },
  mastra_observational_memory: { scope: 'org', note: AI_MEMORY },
  mastra_ai_spans: {
    scope: 'none',
    note: 'no Prisma client model (@@ignore); trace attributes may carry the organization id, expires with the Mastra storage retention. Reported as a residual',
  },
  mastra_evals: { scope: 'none', note: FRAMEWORK },
  mastra_traces: { scope: 'none', note: FRAMEWORK },
  mastra_agent_versions: { scope: 'none', note: FRAMEWORK },
  mastra_agents: { scope: 'none', note: FRAMEWORK },
  mastra_background_tasks: { scope: 'none', note: FRAMEWORK },
  mastra_channel_config: { scope: 'none', note: FRAMEWORK },
  mastra_channel_installations: { scope: 'none', note: FRAMEWORK },
  mastra_dataset_items: { scope: 'none', note: FRAMEWORK },
  mastra_dataset_versions: { scope: 'none', note: FRAMEWORK },
  mastra_datasets: { scope: 'none', note: FRAMEWORK },
  mastra_experiment_results: { scope: 'none', note: FRAMEWORK },
  mastra_experiments: { scope: 'none', note: FRAMEWORK },
  mastra_favorites: { scope: 'none', note: FRAMEWORK },
  mastra_knowledge_activity: { scope: 'none', note: FRAMEWORK },
  mastra_knowledge_cursors: { scope: 'none', note: FRAMEWORK },
  mastra_knowledge_mentions: { scope: 'none', note: FRAMEWORK },
  mastra_knowledge_nodes: { scope: 'none', note: FRAMEWORK },
  mastra_knowledge_records: { scope: 'none', note: FRAMEWORK },
  mastra_knowledge_semantic_outbox: { scope: 'none', note: FRAMEWORK },
  mastra_mcp_client_versions: { scope: 'none', note: FRAMEWORK },
  mastra_mcp_clients: { scope: 'none', note: FRAMEWORK },
  mastra_mcp_server_versions: { scope: 'none', note: FRAMEWORK },
  mastra_mcp_servers: { scope: 'none', note: FRAMEWORK },
  mastra_notifications: { scope: 'none', note: FRAMEWORK },
  mastra_prompt_block_versions: { scope: 'none', note: FRAMEWORK },
  mastra_prompt_blocks: { scope: 'none', note: FRAMEWORK },
  mastra_schedule_triggers: { scope: 'none', note: FRAMEWORK },
  mastra_schedules: { scope: 'none', note: FRAMEWORK },
  mastra_scorer_definition_versions: { scope: 'none', note: FRAMEWORK },
  mastra_scorer_definitions: { scope: 'none', note: FRAMEWORK },
  mastra_skill_blobs: { scope: 'none', note: FRAMEWORK },
  mastra_skill_versions: { scope: 'none', note: FRAMEWORK },
  mastra_skills: { scope: 'none', note: FRAMEWORK },
  mastra_tool_provider_connections: { scope: 'none', note: FRAMEWORK },
  mastra_workflow_definitions: { scope: 'none', note: FRAMEWORK },
  mastra_workspace_versions: { scope: 'none', note: FRAMEWORK },
  mastra_workspaces: { scope: 'none', note: FRAMEWORK },
  OAuthApp: {
    scope: 'org',
    note: 'deleted, holds clientSecret; its picture Media row goes with the media',
  },
  OAuthAuthorization: {
    scope: 'org+user',
    note: 'deleted, holds access tokens and authorization codes',
  },
  OAuthSelfHostedAuthorization: {
    scope: 'org',
    note: 'deleted with the OAuth app (mcpUrl, apiKey, email)',
  },
  Announcement: { scope: 'none', note: 'global announcements' },
  AffiliateProfile: {
    scope: 'user',
    note: 'deleted when it has no commission; otherwise kept with payoutEmail removed and the vanity code replaced, so the ledger keeps its foreign key',
  },
  AffiliateCommission: {
    scope: 'retain',
    note: 'financial ledger, never deleted; it holds only a random organization id, Stripe invoice id, amounts and a payment reference, no personal data',
  },
  Review: {
    scope: 'org+user',
    note: 'deleted (text, displayName, roleCompany)',
  },
  ReviewPrompt: { scope: 'user', note: 'deleted' },
  ApprovalSettings: {
    scope: 'org',
    note: 'deleted; approverIds may name the person, the row goes with the organization',
  },
  ApprovalLink: {
    scope: 'org+user',
    note: 'deleted with the organization (token hash, post ids); in shared organizations createdById is cleared',
  },
  ActivityLog: {
    scope: 'org+user',
    note: 'deleted with the organization; in shared organizations the rows the person acted on keep the action but lose actorUserId and actorName. Client names and emails typed on a share link go with the organization',
  },
  AnalyticsAccountSnapshot: { scope: 'org', note: 'deleted, daily channel counts' },
  AnalyticsPost: { scope: 'org', note: 'deleted, post titles, links and metrics' },
  AnalyticsPostSnapshot: { scope: 'org', note: 'deleted, daily post metrics' },
  AnalyticsReportSettings: {
    scope: 'org',
    note: 'deleted, recipient user ids and branding',
  },
};
