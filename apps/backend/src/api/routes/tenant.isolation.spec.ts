import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// SECURITY_CHECKLIST.md's launch gate: "tenant-isolation tests pass for every
// org-scoped endpoint". Org scoping in this codebase is enforced per query, by
// hand, which is exactly the shape of thing that regresses during an upstream
// merge. These two tests guard the invariant rather than re-testing each query:
//
// 1. every route handler that takes a resource id from the URL is scoped to
//    something - the caller's organization, the caller's user, or a superadmin
//    check - or is listed below with a reason;
// 2. the only post reads that deliberately cross tenants are the public
//    preview's, and they say so with PUBLIC_PREVIEW.
//
// A new endpoint that forgets the organization fails test 1. A new cross-tenant
// read fails test 2.

const ROUTES = [
  join(__dirname),
  join(__dirname, '..', '..', 'public-api', 'routes', 'v1'),
];

// Handlers that take a route parameter and are deliberately not org-scoped.
// Adding a line here is a security decision: say why.
const EXEMPT: Record<string, string> = {
  // unauthenticated by design: the shared preview page and its comments are
  // readable by anyone holding the link
  'public.controller.ts#getPreview': 'public preview page, link is the capability',
  'public.controller.ts#getComments': 'public preview page, link is the capability',
  'public.controller.ts#createComment': 'public preview page, link is the capability',
  // the approval link itself is the capability, and it is a signed token
  'public.approvals.controller.ts#getLink': 'signed approval token is the capability',
  'public.approvals.controller.ts#act': 'signed approval token is the capability',
  // the OAuth/connect flows run before an organization is in context; each
  // resolves its own tenant from the state or token it was given
  'no.auth.integrations.controller.ts#connectSocialMedia': 'pre-auth OAuth callback, resolves its own org',
  'no.auth.integrations.controller.ts#saveProviderPage': 'pre-auth OAuth callback, resolves its own org',
  'no.auth.integrations.controller.ts#cancelLinkConnect': 'pre-auth OAuth callback, drops an unconfirmed shared link by its state',
  // login with a social provider, before any session exists; the route
  // parameter is a provider name, not a tenant-owned resource
  'auth.controller.ts#oauthLink': 'pre-auth login, param is a provider name',
  'auth.controller.ts#oauthRedirect': 'pre-auth login, param is a provider name',
  'auth.controller.ts#oauthExists': 'pre-auth login, param is a provider name',
  // provider webhooks authenticate by signature, not by session
  'payment.controller.ts#webhook': 'Stripe webhook, verified by signature',
  // superadmin only, and the resources are global rather than per-tenant
  'admin.controller.ts#markAffiliatePaid': 'superadmin, global resource',
  'admin.controller.ts#setReviewStatus': 'superadmin, global resource',
  'announcements.controller.ts#deleteAnnouncement': 'superadmin, global resource',
  'monitor.controller.ts#getMessagesGroup': 'superadmin queue monitor, global resource',
  // the id is a provider identifier, not a tenant-owned resource
  'integrations.controller.ts#getInternalPlugs': 'identifier is a provider name, not a resource id',
};

type Handler = { file: string; name: string; params: string; body: string };

const balanced = (src: string, from: number, open: string, close: string) => {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return src.slice(from + 1, i);
    }
  }
  return '';
};

const handlers = (file: string, src: string): Handler[] => {
  const found: Handler[] = [];
  const decorator = /@(Get|Post|Put|Delete|Patch)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = decorator.exec(src))) {
    const route = balanced(src, match.index + match[0].length - 1, '(', ')');
    // only handlers that take something from the URL path
    if (!/:/.test(route)) continue;
    // skip forward over any further decorators to the method signature
    const rest = src.slice(decorator.lastIndex);
    const sig = rest.match(/\n\s*(?:async\s+)?([A-Za-z_]\w*)\s*\(/);
    if (!sig || sig.index === undefined) continue;
    const parenAt = decorator.lastIndex + sig.index + sig[0].length - 1;
    const params = balanced(src, parenAt, '(', ')');
    const braceAt = src.indexOf('{', parenAt + params.length);
    found.push({
      file,
      name: sig[1],
      params,
      body: balanced(src, braceAt, '{', '}'),
    });
  }
  return found;
};

const allHandlers = ROUTES.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.controller.ts'))
    .flatMap((f) => handlers(f, readFileSync(join(dir, f), 'utf8')))
);

describe('tenant isolation', () => {
  it('finds the controllers, so a path change cannot make this test vacuous', () => {
    expect(allHandlers.length).toBeGreaterThan(50);
  });

  it('scopes every handler that takes a resource id from the URL', () => {
    const unscoped = allHandlers
      .filter((h) => {
        const key = `${h.file}#${h.name}`;
        if (EXEMPT[key]) return false;
        if (h.params.includes('GetOrgFromRequest')) return false;
        // user-scoped: the caller's own id has to reach the call, not just the
        // decorator
        if (h.params.includes('GetUserFromRequest') && /\buser\.id\b/.test(h.body))
          return false;
        if (/isSuperAdmin/.test(h.body)) return false;
        return true;
      })
      .map((h) => `${h.file}#${h.name}`);

    expect(unscoped).toEqual([]);
  });

  it('keeps the exemption list honest: every entry still exists and has a reason', () => {
    const live = new Set(allHandlers.map((h) => `${h.file}#${h.name}`));
    const stale = Object.keys(EXEMPT).filter((key) => !live.has(key));
    expect(stale).toEqual([]);
    expect(
      Object.entries(EXEMPT).filter(([, reason]) => reason.trim().length < 10)
    ).toEqual([]);
  });
});

describe('cross-tenant post reads', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sources(join(dir, entry.name))
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
        ? [join(dir, entry.name)]
        : []
    );

  // Every deliberate cross-tenant read, by file. If this list grows, someone
  // added one: check it is a public capability and not an authorization hole.
  const ALLOWED = {
    'posts.repository.ts': 'defines PUBLIC_PREVIEW and orgFilter',
    'posts.service.ts': 'the preview comment list and comment creation',
    'public.controller.ts': 'the preview page itself',
  };

  it('only the public preview crosses tenants, and it says so', () => {
    const root = join(__dirname, '..', '..', '..', '..', '..');
    const files = [
      ...sources(join(root, 'libraries', 'nestjs-libraries', 'src')),
      ...sources(join(root, 'apps', 'backend', 'src')),
      ...sources(join(root, 'apps', 'orchestrator', 'src')),
    ];
    const users = files
      .filter((f) => readFileSync(f, 'utf8').includes('PUBLIC_PREVIEW'))
      .map((f) => f.split('/').pop() as string);

    expect([...new Set(users)].sort()).toEqual(Object.keys(ALLOWED).sort());
  });
});
