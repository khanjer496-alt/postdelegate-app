import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';

@Injectable()
export class WebhooksRepository {
  constructor(
    private _webhooks: PrismaRepository<'webhooks'>,
    private _integration: PrismaRepository<'integration'>
  ) {}

  getTotal(orgId: string) {
    return this._webhooks.model.webhooks.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
  }

  getWebhooks(orgId: string) {
    return this._webhooks.model.webhooks.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      // the oldest first, they are the ones a smaller plan keeps sending
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        integrations: {
          select: {
            integration: {
              select: {
                id: true,
                picture: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }

  deleteWebhook(orgId: string, id: string) {
    return this._webhooks.model.webhooks.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  // only integrations of this organization can be linked to the webhook
  private ownedIntegrations(orgId: string, body: WebhooksDto) {
    return body.integrations?.length
      ? this._integration.model.integration.findMany({
          where: {
            id: {
              in: body.integrations.map((integration) => integration.id),
            },
            organizationId: orgId,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        })
      : Promise.resolve([] as { id: string }[]);
  }

  async createWebhook(orgId: string, body: WebhooksDto) {
    const ownedIntegrations = await this.ownedIntegrations(orgId, body);

    const { id } = await this._webhooks.model.webhooks.create({
      data: {
        organizationId: orgId,
        url: body.url,
        name: body.name,
        integrations: {
          create: ownedIntegrations.map((integration) => ({
            integrationId: integration.id,
          })),
        },
      },
    });

    return { id };
  }

  // only an existing webhook of the organization, never a new one (creating
  // goes through the plan limit)
  async updateWebhook(orgId: string, body: WebhooksDto) {
    const existing = await this._webhooks.model.webhooks.findFirst({
      where: {
        id: body.id,
        organizationId: orgId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return null;
    }

    const ownedIntegrations = await this.ownedIntegrations(orgId, body);

    await this._webhooks.model.webhooks.update({
      where: {
        id: existing.id,
        organizationId: orgId,
      },
      data: {
        url: body.url,
        name: body.name,
        integrations: {
          deleteMany: {},
          create: ownedIntegrations.map((integration) => ({
            integrationId: integration.id,
          })),
        },
      },
    });

    return { id: existing.id };
  }
}
