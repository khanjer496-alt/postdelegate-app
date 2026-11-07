import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  StudioAiProviderAbstract,
  StudioAiProviderParams,
} from '@gitroom/nestjs-libraries/studio/ai/studio.ai.interface';
import { AiCredentialService } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service';

@Injectable()
export class StudioAiManager {
  constructor(
    private _moduleRef: ModuleRef,
    private _aiCredentialService: AiCredentialService
  ) {}

  getAllProviders(): (StudioAiProviderParams & { target: any })[] {
    return (
      Reflect.getMetadata('studio-ai-provider', StudioAiProviderAbstract) || []
    );
  }

  getProvider(identifier: string) {
    const provider = this.getAllProviders().find(
      (p) => p.identifier === identifier
    );
    if (!provider) {
      return undefined;
    }

    return {
      identifier: provider.identifier,
      instance: this._moduleRef.get(provider.target, {
        strict: false,
      }) as StudioAiProviderAbstract,
    };
  }

  // The provider of the key the workspace saved, undefined without one
  async forOrganization(org: string) {
    const credential = await this._aiCredentialService.getCredential(org);
    if (!credential) {
      return undefined;
    }

    return this.getProvider(credential.provider);
  }
}
