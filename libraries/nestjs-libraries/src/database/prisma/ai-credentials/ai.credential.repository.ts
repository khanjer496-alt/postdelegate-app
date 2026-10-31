import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

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
        apiKey: AuthService.fixedEncryption(apiKey),
      },
      update: {
        provider,
        apiKey: AuthService.fixedEncryption(apiKey),
      },
    });
  }

  deleteByOrg(orgId: string) {
    return this._aiCredential.model.aiCredential.deleteMany({
      where: { organizationId: orgId },
    });
  }
}
