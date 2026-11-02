// @ts-ignore
import twitter from 'twitter-text';

// a provider variant ("x-own-key") counts like its network ("x"), the same
// network the publish task queues use
const network = (integrationType: string) => integrationType.split('-')[0];

export const textSlicer = (
  integrationType: string,
  end: number,
  text: string
): { start: number; end: number } => {
  // Bluesky's limit is in graphemes, the cut goes after the last one that fits
  if (network(integrationType) === 'bluesky') {
    return {
      start: 0,
      end: graphemeEnd(text, end),
    };
  }

  if (network(integrationType) !== 'x') {
    return {
      start: 0,
      end,
    };
  }

  const { validRangeEnd, valid } = twitter.parseTweet(text, {
    version: 3,
    maxWeightedTweetLength: end,
    scale: 100,
    defaultWeight: 200,
    emojiParsingEnabled: true,
    transformedURLLength: 23,
    ranges: [
      { start: 0, end: 4351, weight: 100 },
      { start: 8192, end: 8205, weight: 100 },
      { start: 8208, end: 8223, weight: 100 },
      { start: 8242, end: 8247, weight: 100 },
    ],
  });

  return {
    start: 0,
    end: valid ? end : validRangeEnd,
  };
};

export const weightedLength = (text: string): number => {
  return twitter.parseTweet(text).weightedLength;
};

// Intl.Segmenter is in every runtime the app supports, code points are the
// closest count where it is missing
export const graphemeLength = (text: string): number => {
  const Segmenter = (Intl as any).Segmenter;
  if (!Segmenter) {
    return Array.from(text).length;
  }

  return Array.from(
    new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)
  ).length;
};

// the UTF-16 index right after the `count`th grapheme of the text
export const graphemeEnd = (text: string, count: number): number => {
  const Segmenter = (Intl as any).Segmenter;
  if (!Segmenter) {
    return Array.from(text).slice(0, count).join('').length;
  }

  let seen = 0;
  for (const { index, segment } of new Segmenter(undefined, {
    granularity: 'grapheme',
  }).segment(text) as Iterable<{ index: number; segment: string }>) {
    seen++;
    if (seen === count) {
      return index + segment.length;
    }
  }
  return text.length;
};

export const countLength = (integrationType: string, text: string): number => {
  if (network(integrationType) === 'x') {
    return weightedLength(text);
  }

  if (network(integrationType) === 'threads') {
    return new TextEncoder().encode(text).length;
  }

  // Bluesky counts graphemes: an emoji with its modifiers or a flag is one
  // (a network branch here, like x and threads above)
  if (network(integrationType) === 'bluesky') {
    return graphemeLength(text);
  }

  return text.length;
};
