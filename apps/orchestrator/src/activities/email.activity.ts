import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import type { Email } from '@gitroom/orchestrator/signals/email.signal';

@Injectable()
@Activity()
export class EmailActivity {
  constructor(
    private _emailService: EmailService,
    private _organizationService: OrganizationService,
    private _notificationService: NotificationService
  ) {}

  @ActivityMethod()
  async sendEmail(to: string, subject: string, html: string, replyTo?: string) {
    return this._emailService.sendEmailSync(to, subject, html, replyTo);
  }

  @ActivityMethod()
  async sendEmailAsync(to: string, subject: string, html: string, sendTo: 'top' | 'bottom', replyTo?: string) {
    return await this._emailService.sendEmail(to, subject, html, sendTo, replyTo);
  }

  @ActivityMethod()
  async sendDigestEmail(userId: string, to: string, emails: Email[]) {
    return this._notificationService.sendDigestEmail(userId, to, emails);
  }

  @ActivityMethod()
  async getUserOrgs(id: string) {
    // digests and streak emails skip disabled members
    return this._organizationService.getActiveTeam(id);
  }

  @ActivityMethod()
  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationService.setStreak(organizationId, type);
  }

  @ActivityMethod()
  async getLastPublishDate(organizationId: string) {
    return this._organizationService.getLastPublishDate(organizationId);
  }
}
