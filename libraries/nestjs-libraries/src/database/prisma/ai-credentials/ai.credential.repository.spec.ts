process.env.JWT_SECRET = 'test-jwt-secret-for-ai-credentials';
// this spec covers the no-key fallback, so the key must be absent whatever
// else ran in this worker first
delete process.env.TOKEN_ENCRYPTION_KEY;

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AiCredentialRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.repository';

const KEY = 'sk-proj-xxxxxxxxxxxxxxxxxxxxa9F2';

describe('AiCredentialRepository.upsert', () => {
  it('stores the encrypted key, not the plaintext', async () => {
    const aiCredential = { upsert: jest.fn().mockResolvedValue({}) };
    const repo = new AiCredentialRepository({ model: { aiCredential } } as any);

    await repo.upsert('org-1', 'openai', KEY);

    expect(aiCredential.upsert).toHaveBeenCalledTimes(1);
    const { where, create, update } = aiCredential.upsert.mock.calls[0][0];
    expect(where).toEqual({ organizationId: 'org-1' });
    expect(create).toEqual({
      organizationId: 'org-1',
      provider: 'openai',
      apiKey: AuthService.fixedEncryption(KEY),
    });
    expect(update).toEqual({
      provider: 'openai',
      apiKey: AuthService.fixedEncryption(KEY),
    });
    expect(JSON.stringify(aiCredential.upsert.mock.calls)).not.toContain(KEY);
  });
});
