import { ValidationPipe } from '@nestjs/common';
import { CreateOrgUserDto } from './create.org.user.dto';

const validate = (body: Record<string, unknown>) =>
  new ValidationPipe({ transform: true }).transform(body, {
    type: 'body',
    metatype: CreateOrgUserDto,
  }) as Promise<CreateOrgUserDto>;

const signUp = {
  email: 'new@example.com',
  password: 'secret',
  provider: 'LOCAL',
  company: 'Acme',
};

describe('CreateOrgUserDto ref', () => {
  it('keeps a valid code, normalised', async () => {
    expect((await validate({ ...signUp, ref: ' Friend-1 ' })).ref).toBe(
      'friend-1'
    );
  });

  it('accepts a sign-up without a code', async () => {
    expect((await validate(signUp)).ref).toBeUndefined();
  });

  it.each([123, { code: 'x' }, ['friend'], 'ab', 'bad code', 'x'.repeat(500)])(
    'drops %p instead of refusing the sign-up',
    async (ref) => {
      expect((await validate({ ...signUp, ref })).ref).toBeUndefined();
    }
  );
});
