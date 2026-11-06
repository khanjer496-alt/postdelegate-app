import {
  applyEvergreen,
  evergreenAllows,
  evergreenOccurrences,
  evergreenShareIndex,
  evergreenSharesDone,
  evergreenUpcoming,
  isEvergreen,
  parseEvergreenVariants,
} from '@gitroom/nestjs-libraries/database/prisma/posts/posts.evergreen.schedule';

const DAY = 24 * 60 * 60 * 1000;
const anchor = new Date('2026-01-01T10:00:00.000Z');
const at = (days: number, extraMs = 0) =>
  new Date(anchor.getTime() + days * DAY + extraMs);

describe('evergreen schedule', () => {
  it('rounds a slightly late or early run to its share', () => {
    expect(evergreenShareIndex(anchor, at(0), 7)).toBe(0);
    expect(evergreenShareIndex(anchor, at(7, 5 * 60 * 1000), 7)).toBe(1);
    expect(evergreenShareIndex(anchor, at(14, -60 * 1000), 7)).toBe(2);
    expect(evergreenShareIndex(anchor, at(-1), 7)).toBe(0);
  });

  it('allows shares up to the max and the end date', () => {
    const post = { intervalInDays: 7, evergreenMaxShares: 3 };
    expect(evergreenAllows(anchor, 0, post)).toBe(true);
    expect(evergreenAllows(anchor, 3, post)).toBe(true);
    expect(evergreenAllows(anchor, 4, post)).toBe(false);

    const until = { intervalInDays: 7, evergreenUntil: at(15) };
    expect(evergreenAllows(anchor, 2, until)).toBe(true);
    expect(evergreenAllows(anchor, 3, until)).toBe(false);
  });

  it('a plain repeat is not evergreen and stays untouched', () => {
    const post = {
      intervalInDays: 7,
      content: '<p>hi</p>',
      publishDate: anchor,
      state: 'PUBLISHED',
    };
    expect(isEvergreen(post)).toBe(false);
    expect(applyEvergreen(post, at(70))).toBe(post);
  });

  it('rotates through the original and the variants', () => {
    const post = {
      intervalInDays: 7,
      evergreenVariants: JSON.stringify(['Second <b>take</b>', 'Third']),
      content: '<p>Original</p>',
      publishDate: anchor,
      state: 'PUBLISHED',
    };
    expect(applyEvergreen({ ...post, state: 'QUEUE' }, at(0)).content).toBe(
      '<p>Original</p>'
    );
    // variants are escaped plain text
    expect(applyEvergreen(post, at(7)).content).toBe(
      '<p>Second &lt;b&gt;take&lt;/b&gt;</p>'
    );
    expect(applyEvergreen(post, at(14)).content).toBe('<p>Third</p>');
    expect(applyEvergreen(post, at(21)).content).toBe('<p>Original</p>');
  });

  it('drops the interval on the last share so the workflow stops', () => {
    const post = {
      intervalInDays: 7,
      evergreenMaxShares: 2,
      content: '<p>x</p>',
      publishDate: anchor,
      state: 'PUBLISHED',
    };
    expect(applyEvergreen({ ...post, state: 'QUEUE' }).intervalInDays).toBe(7);
    expect(applyEvergreen(post, at(7)).intervalInDays).toBe(7);
    expect(applyEvergreen(post, at(14)).intervalInDays).toBeNull();
  });

  it('stops before a share that would pass the end date', () => {
    const post = {
      intervalInDays: 7,
      evergreenUntil: at(10).toISOString(),
      content: '<p>x</p>',
      publishDate: anchor,
      state: 'QUEUE',
    };
    // the first publish keeps the interval: share 1 (day 7) is before the end
    expect(applyEvergreen(post).intervalInDays).toBe(7);
    // share 1 is the last: share 2 (day 14) is after the end date
    expect(
      applyEvergreen({ ...post, state: 'PUBLISHED' }, at(7)).intervalInDays
    ).toBeNull();
  });

  it('lists the calendar occurrences within the limits', () => {
    expect(
      evergreenOccurrences(anchor, { intervalInDays: 7 }, at(21)).length
    ).toBe(4);
    expect(
      evergreenOccurrences(
        anchor,
        { intervalInDays: 7, evergreenMaxShares: 1 },
        at(70)
      ).map((date) => date.toISOString())
    ).toEqual([anchor.toISOString(), at(7).toISOString()]);
    expect(evergreenOccurrences(anchor, { intervalInDays: null }, at(70))).toEqual([
      anchor,
    ]);
  });

  it('lists the upcoming shares and counts the done ones', () => {
    const post = { intervalInDays: 7, evergreenMaxShares: 3 };
    expect(
      evergreenUpcoming(anchor, post, at(8), 5).map((d) => d.toISOString())
    ).toEqual([at(14).toISOString(), at(21).toISOString()]);
    expect(evergreenUpcoming(anchor, post, at(-1), 1)[0]).toEqual(anchor);
    expect(evergreenUpcoming(anchor, post, at(22))).toEqual([]);
    expect(evergreenSharesDone(anchor, post, at(15))).toBe(2);
    expect(evergreenSharesDone(anchor, post, at(100))).toBe(3);
  });

  it('ignores broken variant data', () => {
    expect(parseEvergreenVariants('nope')).toEqual([]);
    expect(parseEvergreenVariants(JSON.stringify(['a', 3, ' ', 'b']))).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('evergreen after an edit', () => {
  it('a finished post moved forward on its schedule does not start over', () => {
    const post = {
      intervalInDays: 7,
      evergreenMaxShares: 2,
      content: '<p>x</p>',
      // reanchorInterval moved the QUEUE run to share 5 of the schedule
      publishDate: at(35),
      state: 'QUEUE',
    };
    expect(applyEvergreen(post, at(35), anchor).intervalInDays).toBeNull();
    // a post rescheduled to a new date starts a new schedule
    expect(applyEvergreen(post, at(35), at(35)).intervalInDays).toBe(7);
  });
});
