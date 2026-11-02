import { Injectable, NotFoundException } from '@nestjs/common';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

@Injectable()
export class WebhooksService {
  constructor(
    private _webhooksRepository: WebhooksRepository,
    private _subscriptionService: SubscriptionService
  ) {}

  getTotal(orgId: string) {
    return this._webhooksRepository.getTotal(orgId);
  }

  // With billing on, the plan holds only so many webhooks (the oldest first).
  // A downgrade pauses the extra ones without deleting them, the list says
  // so, and an upgrade brings them back
  async getWebhooks(orgId: string) {
    const webhooks = await this._webhooksRepository.getWebhooks(orgId);
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return webhooks.map((webhook) => ({ ...webhook, paused: false }));
    }
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(orgId);
    const limit = pricing[subscription?.subscriptionTier || 'FREE'].webhooks;
    return webhooks.map((webhook, index) => ({
      ...webhook,
      paused: index >= limit,
    }));
  }

  createWebhook(orgId: string, body: WebhooksDto) {
    return this._webhooksRepository.createWebhook(orgId, body);
  }

  // what a published post fires: every webhook the plan holds
  async getWebhooksToSend(orgId: string) {
    return (await this.getWebhooks(orgId)).filter((webhook) => !webhook.paused);
  }

  async updateWebhook(orgId: string, body: WebhooksDto) {
    const updated = await this._webhooksRepository.updateWebhook(orgId, body);
    if (!updated) {
      throw new NotFoundException('Webhook not found');
    }
    return updated;
  }

  deleteWebhook(orgId: string, id: string) {
    return this._webhooksRepository.deleteWebhook(orgId, id);
  }
}
