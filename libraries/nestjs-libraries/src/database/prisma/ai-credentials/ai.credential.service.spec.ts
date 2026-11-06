process.env.JWT_SECRET = 'test-jwt-secret-for-ai-credentials';

const modelsList = jest.fn();
const openAiCtor = jest.fn().mockImplementation(() => ({
  models: { list: modelsList },
}));
jest.mock('openai', () => ({
  __esModule: true,
  default: function (this: unknown, ...args: unknown[]) {
    return openAiCtor(...args);
  },
}));

import { BadRequestException } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AiCredentialService } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service';

const KEY = 'sk-proj-xxxxxxxxxxxxxxxxxxxxa9F2';

describe('AiCredentialService', () => {
  let repository: {
    getByOrg: jest.Mock;
    upsert: jest.Mock;
    deleteByOrg: jest.Mock;
  };
  let service: AiCredentialService;
  const realEnvKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    openAiCtor.mockClear();
    modelsList.mockReset().mockResolvedValue({ data: [] });
    repository = {
      getByOrg: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteByOrg: jest.fn().mockResolvedValue({ count: 1 }),
    };
    service = new AiCredentialService(repository as any);
  });

  afterEach(() => {
    if (realEnvKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = realEnvKey;
    }
  });

  it('saveCredential hands the checked key to the repository, which encrypts it', async () => {
    await service.saveCredential('org-1', { provider: 'openai', apiKey: KEY });

    expect(repository.upsert).toHaveBeenCalledTimes(1);
    expect(repository.upsert).toHaveBeenCalledWith('org-1', 'openai', KEY);
  });

  it('saveCredential returns only the mask', async () => {
    const result = await service.saveCredential('org-1', {
      provider: 'openai',
      apiKey: KEY,
    });

    expect(result).toEqual({ provider: 'openai', maskedKey: 'sk-…a9F2' });
  });

  it('saveCredential rejects a key OpenAI refuses', async () => {
    modelsList.mockRejectedValue(
      Object.assign(new Error(`401 Incorrect API key ${KEY}`), { status: 401 })
    );

    const attempt = service.saveCredential('org-1', {
      provider: 'openai',
      apiKey: KEY,
    });

    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(
      "OpenAI rejected this key. Check it's an active API key with access to models."
    );
    await attempt.catch((err) => {
      expect(String(err.message)).not.toContain(KEY);
    });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('saveCredential treats a 403 as a rejected key', async () => {
    modelsList.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));

    await expect(
      service.saveCredential('org-1', { provider: 'openai', apiKey: KEY })
    ).rejects.toThrow(
      "OpenAI rejected this key. Check it's an active API key with access to models."
    );
  });

  it.each([429, 500, 503, undefined])(
    'saveCredential reports an unreachable OpenAI (status %s) without blaming the key',
    async (status) => {
      modelsList.mockRejectedValue(
        Object.assign(new Error(`failure for ${KEY}`), { status })
      );

      const attempt = service.saveCredential('org-1', {
        provider: 'openai',
        apiKey: KEY,
      });

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(
        "Couldn't reach OpenAI to check this key. Try again in a minute."
      );
      await attempt.catch((err) => {
        expect(String(err.message)).not.toContain(KEY);
      });
      expect(repository.upsert).not.toHaveBeenCalled();
    }
  );

  it('saveCredential validates with a short timeout and no retries', async () => {
    await service.saveCredential('org-1', { provider: 'openai', apiKey: KEY });

    expect(openAiCtor).toHaveBeenCalledWith({
      apiKey: KEY,
      timeout: 15000,
      maxRetries: 0,
    });
  });

  it('getOpenAiClient constructs OpenAI with the decrypted key', async () => {
    repository.getByOrg.mockResolvedValue({
      provider: 'openai',
      apiKey: AuthService.fixedEncryption(KEY),
    });

    const client = await service.getOpenAiClient('org-1');

    expect(openAiCtor).toHaveBeenCalledWith({ apiKey: KEY });
    expect(client).toBeDefined();
  });

  it('getCredential returns the mask of the stored key', async () => {
    repository.getByOrg.mockResolvedValue({
      provider: 'openai',
      apiKey: AuthService.fixedEncryption(KEY),
    });

    await expect(service.getCredential('org-1')).resolves.toEqual({
      provider: 'openai',
      maskedKey: 'sk-…a9F2',
    });
  });

  it('getCredential returns null without a credential', async () => {
    await expect(service.getCredential('org-1')).resolves.toBeNull();
  });

  it('hasCredential reflects whether a row exists', async () => {
    await expect(service.hasCredential('org-1')).resolves.toBe(false);
    repository.getByOrg.mockResolvedValue({
      provider: 'openai',
      apiKey: AuthService.fixedEncryption(KEY),
    });
    await expect(service.hasCredential('org-1')).resolves.toBe(true);
  });

  it('getOpenAiKey returns the decrypted key', async () => {
    repository.getByOrg.mockResolvedValue({
      provider: 'openai',
      apiKey: AuthService.fixedEncryption(KEY),
    });

    await expect(service.getOpenAiKey('org-1')).resolves.toBe(KEY);
  });

  it('getOpenAiKey throws the missing-key error without a credential', async () => {
    const attempt = service.getOpenAiKey('org-1');

    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(
      'Add your OpenAI key in Settings → AI'
    );
  });

  it('getOpenAiKey ignores process.env.OPENAI_API_KEY', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-yyyyyyyyyyyyyyyyyyyyyyyyyyyy';

    await expect(service.getOpenAiKey('org-1')).rejects.toThrow(
      'Add your OpenAI key in Settings → AI'
    );
  });

  it('deleteCredential removes the row', async () => {
    await service.deleteCredential('org-1');

    expect(repository.deleteByOrg).toHaveBeenCalledWith('org-1');
  });
});
