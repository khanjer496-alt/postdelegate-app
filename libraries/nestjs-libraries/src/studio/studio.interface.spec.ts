import {
  assColor,
  assTime,
  escapeAssText,
} from '@gitroom/nestjs-libraries/studio/studio.interface';
import {
  groupCaptionLines,
  wordsFromScript,
  wordsOnOutput,
} from '@gitroom/helpers/utils/studio.captions';

const word = (text: string, start: number, end: number) => ({
  text,
  start,
  end,
});

describe('escapeAssText', () => {
  it('keeps plain text as it is', () => {
    expect(escapeAssText('Stop scrolling, this works!')).toBe(
      'Stop scrolling, this works!'
    );
  });

  it('escapes braces so no override block can be opened', () => {
    const escaped = escapeAssText('{\\pos(0,0)\\fs400}hacked');
    expect(escaped).not.toMatch(/(^|[^\\])\{/);
    expect(escaped.startsWith('\\{')).toBe(true);
    expect(escaped).toContain('\\}');
  });

  it('never lets a backslash form a tag or a line break', () => {
    const escaped = escapeAssText('line\\Nbreak \\h \\{');
    // every user backslash is followed by an invisible word joiner
    expect(escaped).not.toMatch(/\\[Nnh]/);
    expect(escaped).toContain('\\\u2060N');
    // the brace the user wrote is still escaped after their backslash
    expect(escaped).toContain('\\\u2060\\{');
  });

  it('turns line breaks and control characters into nothing that ends the event', () => {
    const escaped = escapeAssText('one\ntwo\r\nthree\u0000four\tfive');
    expect(escaped).toBe('one two threefour five');
    expect(escaped).not.toMatch(/[\r\n]/);
  });
});

describe('groupCaptionLines', () => {
  const words = [
    word('One', 0, 0.3),
    word('two', 0.3, 0.6),
    word('three', 0.6, 0.9),
    word('four', 0.9, 1.2),
    word('five', 1.2, 1.5),
  ];

  it('ends a line at maxWords', () => {
    expect(
      groupCaptionLines(words, 2, 40).map((line) =>
        line.map((p) => p.text).join(' ')
      )
    ).toEqual(['One two', 'three four', 'five']);
  });

  it('ends a line before it passes maxChars', () => {
    expect(
      groupCaptionLines(words, 8, 10).map((line) =>
        line.map((p) => p.text).join(' ')
      )
    ).toEqual(['One two', 'three four', 'five']);
  });

  it('ends a line at a pause', () => {
    expect(
      groupCaptionLines(
        [
          word('Hello', 0, 0.4),
          word('there', 2, 2.4),
          word('friend', 2.4, 2.8),
        ],
        8,
        40
      ).map((line) => line.length)
    ).toEqual([1, 2]);
  });

  it('keeps a single long word on its own line and skips blanks', () => {
    expect(
      groupCaptionLines(
        [
          word('Supercalifragilistic', 0, 1),
          word('  ', 1, 1.1),
          word('ok', 1.1, 1.3),
        ],
        3,
        10
      ).map((line) => line.map((p) => p.text))
    ).toEqual([['Supercalifragilistic'], ['ok']]);
  });
});

describe('wordsFromScript', () => {
  it('spreads the words over the clip by their length', () => {
    const words = wordsFromScript('a bbb', 10, 16);
    expect(words).toEqual([
      { text: 'a', start: 10, end: 12 },
      { text: 'bbb', start: 12, end: 16 },
    ]);
  });

  it('returns nothing for an empty script', () => {
    expect(wordsFromScript('   ', 0, 10)).toEqual([]);
  });
});

describe('wordsOnOutput', () => {
  it('moves words to the output timeline and drops the ones outside', () => {
    expect(
      wordsOnOutput(
        [word('before', 0, 1), word('in', 4, 5), word('edge', 9, 11)],
        { start: 2, end: 10 },
        2,
        4
      )
    ).toEqual([
      { text: 'in', start: 1, end: 1.5 },
      { text: 'edge', start: 3.5, end: 4 },
    ]);
  });
});

describe('ASS values', () => {
  it('writes times as H:MM:SS.cc', () => {
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assTime(61.234)).toBe('0:01:01.23');
    expect(assTime(3725.5)).toBe('1:02:05.50');
  });

  it('writes colours as blue-green-red', () => {
    expect(assColor('#FFD400')).toBe('&H0000D4FF&');
    expect(assColor('not a colour')).toBe('&H00FFFFFF&');
  });
});
