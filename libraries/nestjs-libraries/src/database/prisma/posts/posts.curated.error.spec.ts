import { curatedPostError } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.curated.error';

// the two shapes Post.error is written in: the workflow's own serialized
// failure, and the temporal client's
const workflowFailure = (type: string, message: string) =>
  JSON.stringify({ cause: { type, failure: { message } } });

const clientFailure = (type: string, message: string) =>
  JSON.stringify({
    failure: { cause: { applicationFailureInfo: { type }, message } },
  });

describe('curatedPostError', () => {
  it('keeps a provider message from a bad_body failure', () => {
    expect(
      curatedPostError(
        workflowFailure('bad_body', 'Your video is longer than 60 seconds')
      )
    ).toBe('Your video is longer than 60 seconds');
    expect(
      curatedPostError(clientFailure('bad_body', 'Duplicate post content'))
    ).toBe('Duplicate post content');
  });

  it('drops the unmapped placeholder and our own internal strings', () => {
    expect(curatedPostError(workflowFailure('bad_body', 'Unknown Error'))).toBe(
      null
    );
    expect(
      curatedPostError(workflowFailure('refresh_token', 'Refresh channel needed'))
    ).toBe(null);
    expect(
      curatedPostError(clientFailure('unknown', 'Activity task timed out'))
    ).toBe(null);
  });

  it('drops a failure that is not a provider message, whatever it says', () => {
    // the shapes the digest email used to print in full
    expect(
      curatedPostError(
        workflowFailure(
          'unknown',
          'error:1C800064:Provider routines::bad decrypt'
        )
      )
    ).toBe(null);
    expect(
      curatedPostError(
        workflowFailure(
          'unknown',
          'Unexpected token h in JSON at position 1: https://listmonk.internal'
        )
      )
    ).toBe(null);
  });

  it('drops the plain strings a workflow writes, which all read better elsewhere', () => {
    expect(curatedPostError('Channel disabled')).toBe(null);
    expect(curatedPostError('Refresh channel needed')).toBe(null);
    expect(curatedPostError('No Post')).toBe(null);
    expect(curatedPostError('Already posted')).toBe(null);
    // an object literal's prototype keys are truthy, and this returns a string
    expect(curatedPostError('constructor')).toBe(null);
    expect(curatedPostError('__proto__')).toBe(null);
  });

  it('drops anything that is not a serialized failure', () => {
    expect(curatedPostError(null)).toBe(null);
    expect(curatedPostError('')).toBe(null);
    expect(curatedPostError('Error: socket hang up')).toBe(null);
    expect(curatedPostError('{')).toBe(null);
  });
});
