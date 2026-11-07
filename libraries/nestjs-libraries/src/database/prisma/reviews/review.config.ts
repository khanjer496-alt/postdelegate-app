// When the in-app review card is shown
export const REVIEW_MIN_ACCOUNT_AGE_DAYS = 7;
export const REVIEW_MIN_PUBLISHED_POSTS = 3;
export const REVIEW_DISMISS_DAYS = 30;

// A review at or below this is a private note to us: the person is not asked
// to publish it, and it is never shown publicly
export const REVIEW_LOW_RATING_MAX = 3;

// The public feed is read by the site build, a short cache is plenty
export const REVIEW_FEED_CACHE_MS = 60 * 1000;
export const REVIEW_FEED_LIMIT = 50;
export const REVIEW_ADMIN_LIMIT = 200;
