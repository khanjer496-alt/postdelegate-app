import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AiCredentialDto } from '@gitroom/nestjs-libraries/dtos/ai-credentials/ai.credential.dto';

describe('AiCredentialDto', () => {
  it('trims whitespace around a pasted key', async () => {
    const dto = plainToInstance(AiCredentialDto, {
      provider: 'openai',
      apiKey: '  sk-proj-xxxxxxxxxxxxxxxxxxxxa9F2\n',
    });

    expect(dto.apiKey).toBe('sk-proj-xxxxxxxxxxxxxxxxxxxxa9F2');
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects an unknown provider and a too-short key', async () => {
    const dto = plainToInstance(AiCredentialDto, {
      provider: 'other',
      apiKey: 'short',
    });

    const fields = (await validate(dto)).map((e) => e.property).sort();
    expect(fields).toEqual(['apiKey', 'provider']);
  });
});
