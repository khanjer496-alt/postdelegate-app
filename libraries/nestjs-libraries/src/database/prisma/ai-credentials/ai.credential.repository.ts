import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { writeSecret } from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

// Folded into the AAD of a workspace's own AI key.
export const AI_CREDENTIAL_LABEL = 'ai-credential';

@Injectable()
export class AiCredentialRepository {
  constructor(private _aiCredential: PrismaRepository<'aiCredential'>) {}

  getByOrg(orgId: string) {
    return this._aiCredential.model.aiCredential.findUnique({
      where: { organizationId: orgId },
    });
  }

  upsert(orgId: string, provider: string, apiKey: string) {
    return this._aiCredential.model.aiCredential.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        provider,
        apiKey: writeSecret(apiKey, AI_CREDENTIAL_LABEL),
      },
      update: {
        provider,
        apiKey: writeSecret(apiKey, AI_CREDENTIAL_LABEL),
      },
    });
  }

  deleteByOrg(orgId: string) {
    return this._aiCredential.model.aiCredential.deleteMany({
      where: { organizationId: orgId },
    });
  }
}
