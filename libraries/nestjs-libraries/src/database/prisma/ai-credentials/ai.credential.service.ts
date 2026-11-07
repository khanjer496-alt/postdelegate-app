import { BadRequestException, Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import {
  AI_CREDENTIAL_LABEL,
} from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.repository';
import {
  readLegacySecret,
} from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';
import { AiCredentialRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.repository';
import { AiCredentialDto } from '@gitroom/nestjs-libraries/dtos/ai-credentials/ai.credential.dto';

// What a workspace without a key reads, wherever AI is asked for
export const MISSING_AI_KEY = 'Add your OpenAI key in Settings → AI';

const mask = (key: string) => `${key.slice(0, 3)}…${key.slice(-4)}`;

@Injectable()
export class AiCredentialService {
  constructor(private _aiCredentialRepository: AiCredentialRepository) {}

  async getCredential(orgId: string) {
    const credential = await this._aiCredentialRepository.getByOrg(orgId);
    if (!credential) {
      return null;
    }

    return {
      provider: credential.provider,
      maskedKey: mask(
        readLegacySecret(credential.apiKey, AI_CREDENTIAL_LABEL) || ''
      ),
    };
  }

  async saveCredential(orgId: string, body: AiCredentialDto) {
    try {
      await new OpenAI({
        apiKey: body.apiKey,
        timeout: 15000,
        maxRetries: 0,
      }).models.list();
    } catch (err) {
      const status = (err as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) {
        throw new BadRequestException(
          "OpenAI rejected this key. Check it's an active API key with access to models."
        );
      }
      throw new BadRequestException(
        "Couldn't reach OpenAI to check this key. Try again in a minute."
      );
    }

    await this._aiCredentialRepository.upsert(orgId, body.provider, body.apiKey);

    return { provider: body.provider, maskedKey: mask(body.apiKey) };
  }

  async deleteCredential(orgId: string) {
    await this._aiCredentialRepository.deleteByOrg(orgId);
  }

  async hasCredential(orgId: string) {
    return !!(await this._aiCredentialRepository.getByOrg(orgId));
  }

  async getOpenAiKey(orgId: string) {
    const credential = await this._aiCredentialRepository.getByOrg(orgId);
    if (!credential) {
      throw new BadRequestException(MISSING_AI_KEY);
    }

    const key = readLegacySecret(credential.apiKey, AI_CREDENTIAL_LABEL);
    if (!key) {
      throw new BadRequestException(MISSING_AI_KEY);
    }

    return key;
  }

  async getOpenAiClient(orgId: string) {
    return new OpenAI({ apiKey: await this.getOpenAiKey(orgId) });
  }
}
