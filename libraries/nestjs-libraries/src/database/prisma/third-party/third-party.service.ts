import { Injectable } from '@nestjs/common';
import {
  THIRD_PARTY_KEY_LABEL,
  ThirdPartyRepository,
} from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.repository';
import {
  readLegacySecret,
} from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

@Injectable()
export class ThirdPartyService {
  constructor(private _thirdPartyRepository: ThirdPartyRepository) {}

  getAllThirdPartiesByOrganization(org: string) {
    return this._thirdPartyRepository.getAllThirdPartiesByOrganization(org);
  }

  deleteIntegration(org: string, id: string) {
    return this._thirdPartyRepository.deleteIntegration(org, id);
  }

  // The key to send to the third party, whichever scheme stored it. Callers
  // get a readable key and never see the stored form.
  readApiKey(thirdParty?: { apiKey?: string | null } | null): string {
    return readLegacySecret(thirdParty?.apiKey, THIRD_PARTY_KEY_LABEL) || '';
  }

  getIntegrationById(org: string, id: string) {
    return this._thirdPartyRepository.getIntegrationById(org, id);
  }

  saveIntegration(
    org: string,
    identifier: string,
    apiKey: string,
    data: { name: string; username: string; id: string }
  ) {
    return this._thirdPartyRepository.saveIntegration(org, identifier, apiKey, data);
  }
}
