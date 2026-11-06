// the real service pulls in prisma, the spec only reads route metadata and delegation
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service',
  () => ({ AiCredentialService: class {} })
);

import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { AiCredentialsController } from './ai.credentials.controller';

const policiesOf = (name: keyof AiCredentialsController) =>
  Reflect.getMetadata(CHECK_POLICIES_KEY, AiCredentialsController.prototype[name]);

describe('AiCredentialsController authorization', () => {
  it.each(['saveCredential', 'deleteCredential'] as const)(
    '%s requires an org admin',
    (name) => {
      expect(policiesOf(name)).toEqual([
        [AuthorizationActions.Create, Sections.ADMIN],
      ]);
    }
  );

  it('getCredential is open to any member', () => {
    expect(policiesOf('getCredential')).toBeUndefined();
  });
});

describe('AiCredentialsController rate limits', () => {
  const proto: any = AiCredentialsController.prototype;

  it('limits saving a key per client address, so it can not test keys', () => {
    expect(Reflect.getMetadata('__guards__', proto.saveCredential)).toContain(
      ThrottlerRealIpGuard
    );
    expect(
      Reflect.getMetadata('THROTTLER:LIMITdefault', proto.saveCredential)
    ).toBe(10);
    expect(
      Reflect.getMetadata('THROTTLER:TTLdefault', proto.saveCredential)
    ).toBe(60 * 60 * 1000);
  });
});

describe('AiCredentialsController delegation', () => {
  const org = { id: 'org-1' } as any;
  const service = {
    getCredential: jest.fn().mockResolvedValue({
      provider: 'openai',
      maskedKey: 'sk-…a9F2',
    }),
    saveCredential: jest.fn().mockResolvedValue({
      provider: 'openai',
      maskedKey: 'sk-…a9F2',
    }),
    deleteCredential: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new AiCredentialsController(service as any);

  it('reads the masked credential for the org', async () => {
    await expect(controller.getCredential(org)).resolves.toEqual({
      provider: 'openai',
      maskedKey: 'sk-…a9F2',
    });
    expect(service.getCredential).toHaveBeenCalledWith('org-1');
  });

  it('reads an empty object when the org has no key', async () => {
    service.getCredential.mockResolvedValueOnce(null);
    await expect(controller.getCredential(org)).resolves.toEqual({});
  });

  it('saves for the org and returns only the mask', async () => {
    const body = { provider: 'openai', apiKey: 'sk-secret-secret-secret-1234' } as const;
    const result = await controller.saveCredential(org, body);
    expect(service.saveCredential).toHaveBeenCalledWith('org-1', body);
    expect(JSON.stringify(result)).not.toContain(body.apiKey);
  });

  it('deletes for the org', async () => {
    await expect(controller.deleteCredential(org)).resolves.toEqual({
      success: true,
    });
    expect(service.deleteCredential).toHaveBeenCalledWith('org-1');
  });
});
