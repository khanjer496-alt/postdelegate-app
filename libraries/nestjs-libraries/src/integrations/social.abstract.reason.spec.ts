import { platformReason } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const withCode = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

describe('platformReason', () => {
  it("passes a platform's own sentence through", () => {
    expect(
      platformReason(new Error('Rate limit exceeded, try again in 5 minutes'))
    ).toEqual('Rate limit exceeded, try again in 5 minutes');
    expect(platformReason({ message: 'Board not found' })).toEqual(
      'Board not found'
    );
  });

  it('hides a failure of ours whose message reads like a sentence', () => {
    // TokenEncryptionError carries no node code and its message names an
    // internal environment variable
    const ours = Object.assign(
      new Error(
        'TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 (generate one with: openssl rand -base64 32)'
      ),
      { name: 'TokenEncryptionError' }
    );
    expect(platformReason(ours)).toBe(undefined);
  });

  it('hides a failed decryption, which can be followed by what we decrypted', () => {
    // a JWT_SECRET or TOKEN_ENCRYPTION_KEY mismatch in production
    expect(
      platformReason(
        withCode(
          'error:1C800064:Provider routines::bad decrypt',
          'ERR_OSSL_BAD_DECRYPT'
        )
      )
    ).toBeUndefined();
    // the same failure on a build that sets no code
    expect(
      platformReason(new Error('error:1C800064:Provider routines::bad decrypt'))
    ).toBeUndefined();
  });

  it('hides a parse error, which quotes the bytes it was given', () => {
    let parse: unknown;
    try {
      JSON.parse('service=https://example.com,password=hunter2');
    } catch (err) {
      parse = err;
    }
    expect(platformReason(parse)).toBeUndefined();
  });

  it('hides the runtime errors a customer must never read on a post', () => {
    // the one that reached a post on staging
    expect(
      platformReason(
        new TypeError(
          'The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received null'
        )
      )
    ).toBeUndefined();
    expect(
      platformReason(new TypeError("Cannot read properties of undefined (reading 'id')"))
    ).toBeUndefined();
    expect(
      platformReason(withCode("ENOENT: no such file or directory, open '/uploads/x.png'", 'ENOENT'))
    ).toBeUndefined();
    expect(
      platformReason(withCode('read ECONNRESET', 'ECONNRESET'))
    ).toBeUndefined();
    expect(
      platformReason(withCode('getaddrinfo EAI_AGAIN bsky.social', 'EAI_AGAIN'))
    ).toBeUndefined();
    expect(platformReason(new RangeError('Maximum call stack size exceeded'))).toBeUndefined();
  });

  it('hides anything that is not one readable sentence', () => {
    expect(platformReason(new Error('a'.repeat(301)))).toBeUndefined();
    expect(
      platformReason(new Error('Error: boom\n    at Object.<anonymous>'))
    ).toBeUndefined();
    expect(platformReason(new Error('   '))).toBeUndefined();
    expect(platformReason('a string, not an error')).toBeUndefined();
    expect(platformReason(undefined)).toBeUndefined();
  });
});
