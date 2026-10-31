import { Injectable } from '@nestjs/common';
import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';
import { ResendProvider } from '@gitroom/nestjs-libraries/emails/resend.provider';
import { EmptyProvider } from '@gitroom/nestjs-libraries/emails/empty.provider';
import { NodeMailerProvider } from '@gitroom/nestjs-libraries/emails/node.mailer.provider';
import { TemporalService } from 'nestjs-temporal-core';
import { timer } from '@gitroom/helpers/utils/timer';
import { randomUUID } from 'crypto';
import { escape } from 'lodash';

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// A call-to-action button built from a table, so it renders in every email
// client (Outlook ignores padding on links, so the cell carries it too)
export const emailButton = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px"><tr><td style="border-radius:999px;background:#7357ff;mso-padding-alt:14px 28px"><a class="pd-btn" href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px">${escape(
    label
  )}</a></td></tr></table>`;

// One status card per notification, e.g. in the digest email
export type EmailCard = {
  tone: 'success' | 'fail' | 'info';
  status: string;
  title?: string;
  icon?: string;
  time?: string;
  message?: string;
  link?: { href: string; label: string };
};

const cardTones = {
  success: { card: 'pd-item', badge: 'pd-badge-ok', bg: '#f7f6fb', border: '#e7e5ef', badgeBg: '#e9f9cf', badgeColor: '#356b00' },
  info: { card: 'pd-item', badge: 'pd-badge-info', bg: '#f7f6fb', border: '#e7e5ef', badgeBg: '#ece8ff', badgeColor: '#4b32c9' },
  fail: { card: 'pd-item-fail', badge: 'pd-badge-fail', bg: '#fff5f5', border: '#f4c7c7', badgeBg: '#fde1e1', badgeColor: '#b42318' },
};

export const emailCard = (card: EmailCard) => {
  const tone = cardTones[card.tone];
  const icon = card.icon
    ? `<td width="36" valign="top" style="width:36px;padding:16px 0 16px 16px"><img src="${escape(
        card.icon
      )}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border:0;border-radius:9px"></td>`
    : '';
  const title = card.title
    ? `<div class="pd-text" style="font-family:${FONT};font-size:15px;font-weight:700;line-height:1.35;color:#0d0d0d">${escape(
        card.title
      )}</div>`
    : '';
  const time = card.time
    ? `<div class="pd-muted" style="margin-top:2px;font-family:${FONT};font-size:12px;line-height:1.5;color:#7a7a88">${escape(
        card.time
      )}</div>`
    : '';
  const message = card.message
    ? `<div class="pd-text" style="margin-top:8px;font-family:${FONT};font-size:14px;line-height:1.55;color:#2b2b33;word-break:break-word">${escape(
        card.message
      )}</div>`
    : '';
  const link = card.link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px"><tr><td style="border-radius:999px;background:#7357ff;mso-padding-alt:9px 16px"><a class="pd-btn" href="${escape(
        card.link.href
      )}" target="_blank" style="display:inline-block;padding:9px 16px;font-family:${FONT};font-size:13px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px">${escape(
        card.link.label
      )}</a></td></tr></table>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${tone.card}" style="margin:0 0 12px;background:${tone.bg};border:1px solid ${tone.border};border-radius:14px;border-collapse:separate"><tr>${icon}<td valign="top" style="padding:16px">${title}${time}<div style="margin-top:${
    card.title || card.time ? 8 : 0
  }px"><span class="${tone.badge}" style="display:inline-block;padding:3px 10px;border-radius:999px;background:${tone.badgeBg};font-family:${FONT};font-size:12px;font-weight:600;line-height:1.5;color:${tone.badgeColor}">${escape(
    card.status
  )}</span></div>${message}${link}</td></tr></table>`;
};

// Every email shares one branded frame: table layout and inline styles for
// email clients, with a dark mode for the clients that support it
const emailLayout = (subject: string, html: string) => {
  const title = escape(subject);
  const app = process.env.FRONTEND_URL;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<style>
  .pd-body a { color: #5b3fe6; }
  @media (prefers-color-scheme: dark) {
    .pd-bg { background: #0d0d0d !important; }
    .pd-card { background: #17171c !important; border-color: #2a2a33 !important; }
    .pd-text, .pd-brand { color: #f2f2f6 !important; }
    .pd-muted, .pd-muted a { color: #9a9aa8 !important; }
    .pd-body a { color: #b9a8ff !important; }
    .pd-body a.pd-btn { color: #ffffff !important; }
    .pd-item { background: #1f1f26 !important; border-color: #2e2e38 !important; }
    .pd-item-fail { background: #2a1719 !important; border-color: #5a2a2f !important; }
    .pd-badge-ok { background: #2c3d12 !important; color: #c8ff4d !important; }
    .pd-badge-info { background: #2b2550 !important; color: #c9bdff !important; }
    .pd-badge-fail { background: #4a1d22 !important; color: #ffb4b4 !important; }
  }
  @media (max-width: 620px) {
    .pd-card { padding: 28px 22px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f3f8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pd-bg" style="background:#f4f3f8">
  <tr>
    <td align="center" style="padding:36px 16px">
      <!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
        <tr>
          <td style="padding:0 6px 18px">
            <a href="${app}" target="_blank" style="text-decoration:none">
              <img src="${app}/postdelegate-icon-192.png" width="30" height="30" alt="" style="vertical-align:middle;border:0;border-radius:8px">
              <span class="pd-brand" style="vertical-align:middle;margin-left:8px;font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:-0.3px;color:#0d0d0d">PostDelegate</span>
            </a>
          </td>
        </tr>
        <tr>
          <td class="pd-card" style="background:#ffffff;border:1px solid #e7e5ef;border-radius:18px;padding:36px 40px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px"><tr><td width="44" height="4" style="width:44px;height:4px;border-radius:2px;background:#c8ff4d;font-size:0;line-height:0">&nbsp;</td></tr></table>
            <h1 class="pd-text" style="margin:0 0 14px;font-family:${FONT};font-size:23px;font-weight:700;line-height:1.3;letter-spacing:-0.3px;color:#0d0d0d">${title}</h1>
            <div class="pd-text pd-body" style="font-family:${FONT};font-size:15px;line-height:1.65;color:#2b2b33">${html}</div>
          </td>
        </tr>
        <tr>
          <td class="pd-muted" style="padding:22px 8px 0;font-family:${FONT};font-size:12px;line-height:1.7;color:#7a7a88;text-align:center">
            Sent by ${escape(
              process.env.EMAIL_FROM_NAME || 'PostDelegate'
            )}, operated by Nasida Apps LLC.<br>
            <a href="${app}/settings" target="_blank" style="color:#7a7a88">Notification preferences</a>
            &nbsp;&middot;&nbsp;
            <a href="https://postdelegate.com/support" target="_blank" style="color:#7a7a88">Help</a>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
};

@Injectable()
export class EmailService {
  emailService: EmailInterface;
  constructor(private _temporalService: TemporalService) {
    this.emailService = this.selectProvider(process.env.EMAIL_PROVIDER!);
    console.log('Email service provider:', this.emailService.name);
    for (const key of this.emailService.validateEnvKeys) {
      if (!process.env[key]) {
        console.error(`Missing environment variable: ${key}`);
      }
    }
  }

  hasProvider() {
    return !(this.emailService instanceof EmptyProvider);
  }

  selectProvider(provider: string) {
    switch (provider) {
      case 'resend':
        return new ResendProvider();
      case 'nodemailer':
        return new NodeMailerProvider();
      default:
        return new EmptyProvider();
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    addTo: 'top' | 'bottom',
    replyTo?: string
  ) {
    if (!to || !subject) {
      return;
    }

    return this._temporalService.client
      .getRawClient()
      ?.workflow.start('sendSingleEmailWorkflow', {
        taskQueue: 'main',
        workflowId: `send_email_${randomUUID()}`,
        args: [{ to, subject, html, replyTo, addTo }],
      });
  }

  async sendEmailSync(
    to: string,
    subject: string,
    html: string,
    replyTo?: string
  ) {
    if (to.indexOf('@') === -1) {
      return;
    }

    if (!process.env.EMAIL_FROM_ADDRESS || !process.env.EMAIL_FROM_NAME) {
      console.log(
        'Email sender information not found in environment variables'
      );
      return;
    }

    const modifiedHtml = emailLayout(subject, html);

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const sends = await this.emailService.sendEmail(
          to,
          subject,
          modifiedHtml,
          process.env.EMAIL_FROM_NAME,
          process.env.EMAIL_FROM_ADDRESS,
          replyTo
        );
        console.log(sends);
        return;
      } catch (err) {
        lastErr = err;
        console.log(`Email attempt ${attempt + 1}/3 failed:`, err);
        if (attempt < 2) {
          await timer(700);
        }
      }
    }
    console.log(`Email to ${to} failed after 3 attempts:`, lastErr);
  }
}
