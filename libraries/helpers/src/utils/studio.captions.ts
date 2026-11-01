// Caption timing shared by the Studio editor preview and the render, so the
// words light up in the browser exactly when they do in the video. Words are
// in the ClippingWord shape: text with start and end in seconds
export interface StudioWord {
  text: string;
  start: number;
  end: number;
}

// Words grouped into the lines shown one at a time: a line ends when it has
// maxWords words, when the next word would pass maxChars, or at a pause
export const groupCaptionLines = (
  words: StudioWord[],
  maxWords: number,
  maxChars: number,
  maxGap = 0.8
) => {
  const lines: StudioWord[][] = [];
  let line: StudioWord[] = [];
  let chars = 0;
  for (const word of words) {
    const text = word.text.trim();
    if (!text) {
      continue;
    }

    const previous = line[line.length - 1];
    if (
      line.length &&
      (line.length >= maxWords ||
        chars + 1 + text.length > maxChars ||
        word.start - previous.end > maxGap)
    ) {
      lines.push(line);
      line = [];
      chars = 0;
    }

    chars += (line.length ? 1 : 0) + text.length;
    line.push({ ...word, text });
  }

  if (line.length) {
    lines.push(line);
  }

  return lines;
};

// A typed script as timed words: the clip is shared by the length of each
// word, so long words stay up longer. The editor lets the customer fix lines
export const wordsFromScript = (
  script: string,
  start: number,
  end: number
): StudioWord[] => {
  const tokens = script.split(/\s+/).filter(Boolean).slice(0, 1500);
  const total = tokens.reduce((all, token) => all + token.length + 1, 0);
  const length = Math.max(0, end - start);
  let at = start;
  return tokens.map((token) => {
    const duration = (length * (token.length + 1)) / total;
    const word = {
      text: token.slice(0, 60),
      start: Number(at.toFixed(3)),
      end: Number((at + duration).toFixed(3)),
    };
    at += duration;
    return word;
  });
};

// Words on the source timeline moved to the output one (trim, speed), without
// the ones outside of the clip
export const wordsOnOutput = (
  words: StudioWord[],
  trim: { start: number; end: number },
  speed: number,
  duration: number
) =>
  words
    .filter((word) => word.end > trim.start && word.start < trim.end)
    .map((word) => ({
      text: word.text,
      start: Math.max(0, (word.start - trim.start) / speed),
      end: Math.min(duration, (word.end - trim.start) / speed),
    }))
    .filter((word) => word.end > word.start);
