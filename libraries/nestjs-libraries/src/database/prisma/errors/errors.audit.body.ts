// Errors.body is a debug snapshot of the posts a workflow was publishing when
// it failed. The super-admin errors view, the post debug export and the debug
// timeline show it. The workflows hand over whole post rows, and those carry
// the decrypted integration (token, refreshToken, customInstanceDetails) and
// the submittedForOrder tree, so this is an allowlist, not a denylist (OWASP
// Logging Cheat Sheet): a post keeps only the fields below, its integration
// only what names the channel, and anything else - a column added to Post
// later included - is dropped rather than stored.
//
// It runs when a body is written (PostsRepository.writeState), on every read
// of a stored body (rows written before the allowlist), and in the
// scrub-error-bodies command. Idempotent: a body it produced comes back
// unchanged. Best-effort: it never throws, and whatever it cannot read
// becomes '{}', the column default.

type Keep = (value: unknown, depth: number) => unknown;

const EMPTY = '{}';

// a thread or a comment chain is a few levels deep; this only stops an
// object that refers back to itself
const MAX_DEPTH = 5;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

// text, a number, a flag, null or a date - never an object
const scalar: Keep = (value) => {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  return value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? value
    : undefined;
};

const keep = (
  source: Record<string, unknown>,
  fields: Record<string, Keep>,
  depth: number
) =>
  Object.entries(fields).reduce((kept, [field, read]) => {
    const value = read(source[field], depth);
    return value === undefined ? kept : { ...kept, [field]: value };
  }, {} as Record<string, unknown>);

const INTEGRATION_FIELDS: Record<string, Keep> = {
  id: scalar,
  name: scalar,
  providerIdentifier: scalar,
};

const IMAGE_FIELDS: Record<string, Keep> = {
  id: scalar,
  name: scalar,
  path: scalar,
  alt: scalar,
  thumbnail: scalar,
  thumbnailTimestamp: scalar,
};

// The post's provider settings (the composer's per-channel options), stored as
// a JSON string, or already parsed by the caller. None of the provider
// settings DTOs holds a credential. Settings that cannot be serialized are
// dropped on their own, not with the rest of the body.
const settings: Keep = (value) => {
  if (typeof value === 'string') {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
};

// The media list, a JSON string on the row. Kept in the form it came in.
const images: Keep = (value, depth) => {
  const list = typeof value === 'string' ? parseJson(value) : value;
  if (!Array.isArray(list)) {
    return undefined;
  }
  const kept = list
    .filter(isRecord)
    .map((item) => keep(item, IMAGE_FIELDS, depth));
  return typeof value === 'string' ? JSON.stringify(kept) : kept;
};

const integration: Keep = (value, depth) =>
  isRecord(value) ? keep(value, INTEGRATION_FIELDS, depth) : undefined;

const posts: Keep = (value, depth) =>
  Array.isArray(value) && depth <= MAX_DEPTH
    ? value.filter(isRecord).map((post) => keep(post, POST_FIELDS, depth))
    : undefined;

// What is needed to understand a failed post and to rebuild it with the
// debug import. Post.error is left out on purpose: the same failure is the
// Errors row's own message.
const POST_FIELDS: Record<string, Keep> = {
  id: scalar,
  group: scalar,
  state: scalar,
  publishDate: scalar,
  organizationId: scalar,
  integrationId: scalar,
  parentPostId: scalar,
  content: scalar,
  title: scalar,
  description: scalar,
  settings,
  image: images,
  delay: scalar,
  intervalInDays: scalar,
  releaseId: scalar,
  releaseURL: scalar,
  creationMethod: scalar,
  createdAt: scalar,
  updatedAt: scalar,
  deletedAt: scalar,
  integration,
  childrenPost: (value, depth) => posts(value, depth + 1),
};

export const auditErrorBody = (body: unknown): string => {
  try {
    const value = typeof body === 'string' ? parseJson(body) : body;
    const audited = Array.isArray(value)
      ? posts(value, 0)
      : isRecord(value)
      ? keep(value, POST_FIELDS, 0)
      : undefined;
    return audited === undefined ? EMPTY : JSON.stringify(audited);
  } catch {
    return EMPTY;
  }
};
