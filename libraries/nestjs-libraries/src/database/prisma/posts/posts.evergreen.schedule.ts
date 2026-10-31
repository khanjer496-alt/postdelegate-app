import { plainTextToHtml } from '@gitroom/helpers/utils/plain.text.to.html';

// Evergreen extends the repeat-post feature (intervalInDays): the publish
// workflow re-shares the same post every interval, and these limits decide
// when it stops and which text each share uses. Share 0 is the first publish,
// share k happens k intervals after the post's publishDate (its anchor, which
// a repeating post keeps forever).

const DAY = 24 * 60 * 60 * 1000;

export type EvergreenFields = {
  intervalInDays?: number | null;
  evergreenMaxShares?: number | null;
  evergreenUntil?: Date | string | null;
  evergreenVariants?: string | null;
};

const time = (date: Date | string | number) => new Date(date).getTime();

export const parseEvergreenVariants = (raw?: string | null): string[] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((p) => typeof p === 'string' && p.trim())
      : [];
  } catch (err) {
    return [];
  }
};

// a repeating post with any evergreen limit or variant; a plain repeat keeps
// its old behaviour untouched
export const isEvergreen = (post: EvergreenFields) =>
  !!post.intervalInDays &&
  (post.evergreenMaxShares != null ||
    !!post.evergreenUntil ||
    parseEvergreenVariants(post.evergreenVariants).length > 0);

// the share a run publishes, rounded so a run a few minutes late (retries,
// worker lag) still counts as the share it was scheduled for
export const evergreenShareIndex = (
  anchor: Date | string,
  now: Date | number | string,
  intervalInDays: number
) =>
  Math.max(0, Math.round((time(now) - time(anchor)) / (intervalInDays * DAY)));

export const evergreenShareDate = (
  anchor: Date | string,
  index: number,
  intervalInDays: number
) => new Date(time(anchor) + index * intervalInDays * DAY);

// whether share `index` is allowed by the limits (share 0 always is)
export const evergreenAllows = (
  anchor: Date | string,
  index: number,
  post: EvergreenFields
) => {
  if (!post.intervalInDays) {
    return index === 0;
  }
  if (index === 0) {
    return true;
  }
  if (post.evergreenMaxShares != null && index > post.evergreenMaxShares) {
    return false;
  }
  if (
    post.evergreenUntil &&
    time(evergreenShareDate(anchor, index, post.intervalInDays)) >
      time(post.evergreenUntil)
  ) {
    return false;
  }
  return true;
};

// the text of share `index`: the original first, then each variant in turn
export const evergreenText = (
  original: string,
  variants: string[],
  index: number
) => {
  const texts = [original, ...variants.map(plainTextToHtml)];
  return texts[index % texts.length];
};

// What the publish workflow gets for this run: the rotated text and, on the
// last share, no interval, so the workflow does not schedule another one.
// A QUEUE run publishes on its own date: share 0, unless the date was moved
// forward on the schedule (reanchorInterval), then the share of that date.
// `anchor` is the stored publishDate, before any such move.
export const applyEvergreen = <
  T extends EvergreenFields & {
    content: string;
    publishDate: Date | string;
    state?: string;
  }
>(
  post: T,
  now: Date | number = Date.now(),
  anchor: Date | string = post?.publishDate
): T => {
  if (!post || !isEvergreen(post)) {
    return post;
  }
  const index = evergreenShareIndex(
    anchor,
    post.state === 'QUEUE' ? post.publishDate : now,
    post.intervalInDays!
  );

  return {
    ...post,
    content: evergreenText(
      post.content,
      parseEvergreenVariants(post.evergreenVariants),
      index
    ),
    intervalInDays: evergreenAllows(anchor, index + 1, post)
      ? post.intervalInDays
      : null,
  };
};

// every share date from the anchor up to `rangeEnd`, for the calendar
export const evergreenOccurrences = (
  anchor: Date | string,
  post: EvergreenFields,
  rangeEnd: Date | string
): Date[] => {
  if (!post.intervalInDays) {
    return [new Date(anchor)];
  }
  const list: Date[] = [];
  for (let index = 0; ; index++) {
    const date = evergreenShareDate(anchor, index, post.intervalInDays);
    if (time(date) > time(rangeEnd) || !evergreenAllows(anchor, index, post)) {
      break;
    }
    list.push(date);
  }
  return list;
};

// the next shares still to come after `now`, null-free and in order
export const evergreenUpcoming = (
  anchor: Date | string,
  post: EvergreenFields,
  now: Date | number = Date.now(),
  count = 5
): Date[] => {
  if (!post.intervalInDays) {
    return time(anchor) > time(now) ? [new Date(anchor)] : [];
  }
  const interval = post.intervalInDays * DAY;
  const first = Math.max(
    0,
    Math.floor((time(now) - time(anchor)) / interval) + 1
  );
  const start = time(anchor) > time(now) ? 0 : first;
  const list: Date[] = [];
  for (let index = start; list.length < count; index++) {
    if (!evergreenAllows(anchor, index, post)) {
      break;
    }
    list.push(evergreenShareDate(anchor, index, post.intervalInDays));
  }
  return list;
};

// how many re-shares already went out (the first publish not counted)
export const evergreenSharesDone = (
  anchor: Date | string,
  post: EvergreenFields,
  now: Date | number = Date.now()
) => {
  if (!post.intervalInDays || time(anchor) > time(now)) {
    return 0;
  }
  const passed = Math.floor(
    (time(now) - time(anchor)) / (post.intervalInDays * DAY)
  );
  let done = 0;
  for (let index = 1; index <= passed; index++) {
    if (!evergreenAllows(anchor, index, post)) {
      break;
    }
    done++;
  }
  return done;
};
