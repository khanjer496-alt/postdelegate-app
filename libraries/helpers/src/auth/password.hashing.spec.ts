import { AuthService } from '@gitroom/helpers/auth/auth.service';

describe('password hashing', () => {
  it('hashes new passwords at cost 12', () => {
    expect(AuthService.hashPassword('correct horse')).toMatch(/^\$2[aby]\$12\$/);
  });

  it('still verifies a hash made at the old cost', () => {
    // generated with cost 10, the value this codebase used before
    const atCost10 = require('bcrypt').hashSync('correct horse', 10);
    expect(atCost10).toMatch(/^\$2[aby]\$10\$/);
    expect(AuthService.comparePassword('correct horse', atCost10)).toBe(true);
    expect(AuthService.comparePassword('wrong', atCost10)).toBe(false);
  });

  it('verifies a hash it made itself', () => {
    const hash = AuthService.hashPassword('correct horse');
    expect(AuthService.comparePassword('correct horse', hash)).toBe(true);
    expect(AuthService.comparePassword('Correct horse', hash)).toBe(false);
  });
});
