import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { SignatureDto } from '@gitroom/nestjs-libraries/dtos/signature/signature.dto';
import { SignatureType } from '@prisma/client';

@Injectable()
export class SignatureRepository {
  constructor(
    private _signatures: PrismaRepository<'signatures'>,
    private _transaction: PrismaTransaction
  ) {}

  getSignaturesByOrgId(
    orgId: string,
    type: SignatureType = SignatureType.SIGNATURE
  ) {
    return this._signatures.model.signatures.findMany({
      where: { organizationId: orgId, type, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  getDefaultSignature(orgId: string) {
    return this._signatures.model.signatures.findFirst({
      where: {
        organizationId: orgId,
        type: SignatureType.SIGNATURE,
        autoAdd: true,
        deletedAt: null,
      },
    });
  }

  async createOrUpdateSignature(
    orgId: string,
    signature: SignatureDto,
    id?: string
  ) {
    // the type is fixed on creation, an update keeps the stored one
    const existing = id
      ? await this._signatures.model.signatures.findFirst({
          where: { id, organizationId: orgId },
          select: { type: true },
        })
      : null;
    const type = existing?.type || signature.type || SignatureType.SIGNATURE;
    const values = {
      organizationId: orgId,
      content: signature.content,
      // templates are inserted on demand, only a signature can be auto added
      autoAdd: type === SignatureType.SIGNATURE && signature.autoAdd,
      ...(signature.name !== undefined ? { name: signature.name } : {}),
    };

    // one transaction: the workspace never ends up with two auto-added
    // signatures, or with the old one switched off and the new one not saved
    return this._transaction.model.$transaction(async (tx) => {
      const { id: updatedId } = await tx.signatures.upsert({
        where: { id: id || uuidv4(), organizationId: orgId },
        update: values,
        create: { ...values, type },
        select: { id: true },
      });

      if (values.autoAdd) {
        await tx.signatures.updateMany({
          where: { organizationId: orgId, id: { not: updatedId } },
          data: { autoAdd: false },
        });
      }

      return { id: updatedId };
    });
  }

  deleteSignature(orgId: string, id: string) {
    return this._signatures.model.signatures.update({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }
}
