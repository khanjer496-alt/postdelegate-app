import { Injectable, Logger } from '@nestjs/common';
import { escape } from 'lodash';
import { TrialOnboardingRepository } from '@gitroom/nestjs-libraries/database/prisma/trial-onboarding/trial.onboarding.repository';
import {
  EmailService,
  emailButton,
  emailCard,
} from '@gitroom/nestjs-libraries/services/email.service';

const HOUR = 60 * 60 * 1000;
const PAGE = 200;
// emails sent per hourly run, the next run picks up the rest
const RUN_LIMIT = 500;
// Trials that started before the series shipped never get it: without this a
// workspace a few days into its trial would get a "day 1" email on deploy day
export const TRIAL_ONBOARDING_FROM = new Date('2026-11-02T00:00:00.000Z');
const DOCS = 'https://postdelegate.com/docs';
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Each step is sent from `after` hours into the trial. A step that wasn't sent
// within a day of that (the orchestrator was down) is skipped, not sent late.
// The trial ending reminder is not a step: Stripe's trial_will_end sends it.
export const TRIAL_ONBOARDING_STEPS = [
  { step: 'day_1', after: 24 },
  { step: 'day_3', after: 72 },
] as const;

export type TrialOnboardingStep =
  (typeof TRIAL_ONBOARDING_STEPS)[number]['step'];

export type TrialOnboardingEmail =
  | { step: 'day_1'; variant: 'connect_channel' }
  | { step: 'day_1'; variant: 'first_post'; channels: number }
  | { step: 'day_3'; channels: number; agentApproval: boolean };

const paragraph = (html: string) => `<p style="margin:0 0 16px">${html}</p>`;

const heading = (text: string) =>
  `<h2 class="pd-text" style="margin:28px 0 12px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1.35;color:#0d0d0d">${escape(
    text
  )}</h2>`;

const muted = (html: string) =>
  `<p class="pd-muted" style="margin:16px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:#7a7a88">${html}</p>`;

const link = (href: string, label: string) =>
  `<a href="${escape(href)}" target="_blank">${escape(label)}</a>`;

const list = (items: string[], ordered = false) => {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag} style="margin:0 0 16px;padding-left:22px">${items
    .map((item) => `<li style="margin:0 0 6px">${item}</li>`)
    .join('')}</${tag}>`;
};

const quote = (text: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pd-item" style="margin:0 0 16px;background:#f7f6fb;border:1px solid #e7e5ef;border-radius:14px;border-collapse:separate"><tr><td class="pd-text" style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.55;font-style:italic;color:#2b2b33">${escape(
    text
  )}</td></tr></table>`;

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

// The getting started emails of a trial. Pure, so it is easy to test.
export const trialOnboardingEmail = (
  email: TrialOnboardingEmail,
  workspace: string,
  app = process.env.FRONTEND_URL || ''
) => {
  if (email.step === 'day_3') {
    return {
      subject: 'Let Claude or ChatGPT draft a week of posts',
      html: [
        ...(email.channels
          ? []
          : [
              paragraph(
                `First, ${link(
                  `${app}/launches?onboarding=true`,
                  'connect a channel'
                )}. An assistant can only draft posts for channels you've connected.`
              ),
            ]),
        paragraph(
          'If you already use Claude or ChatGPT, you can connect it to PostDelegate and hand it the planning. Ask for something like:'
        ),
        quote(
          'Draft five posts for next week about our new feature, one a day at 9am, for my channels.'
        ),
        paragraph(
          "It looks up your channels, follows each network's rules and adds the posts to your calendar. You sign in with your PostDelegate account, so there is no key to copy."
        ),
        emailCard({
          tone: 'info',
          status: 'Custom connector',
          title: 'Claude',
          message:
            'Add PostDelegate under Settings, then Connectors in Claude.',
          link: { href: `${DOCS}/mcp/claude`, label: 'Connect Claude' },
        }),
        emailCard({
          tone: 'info',
          status: 'Custom connector',
          title: 'ChatGPT',
          message:
            'Add PostDelegate under Settings, then Connectors in ChatGPT, on ChatGPT plans that support custom connectors.',
          link: { href: `${DOCS}/mcp/chatgpt`, label: 'Connect ChatGPT' },
        }),
        ...(email.agentApproval
          ? [
              heading('Nothing goes out without you'),
              paragraph(
                `Posts that Claude or ChatGPT create wait in your Approvals inbox until you approve them, so you can read, edit or reject each one first. You can change this in Settings &gt; Approvals. ${link(
                  `${DOCS}/approvals`,
                  'How approvals work'
                )}`
              ),
            ]
          : [
              heading('Review before anything goes out'),
              paragraph(
                `Ask for drafts and check them on the calendar before you schedule. To hold every post from an AI assistant until someone approves it, turn on Require approval for AI-created posts in Settings &gt; Approvals. ${link(
                  `${DOCS}/approvals`,
                  'How approvals work'
                )}`
              ),
            ]),
        heading('Prefer to write inside PostDelegate?'),
        paragraph(
          'Add your own OpenAI API key in Settings &gt; AI to turn on AI writing and the Agent for the whole workspace. You pay OpenAI directly for what you use. PostDelegate never charges for AI.'
        ),
        emailButton(`${app}/settings?tab=ai`, 'Open Settings > AI'),
      ].join(''),
    };
  }

  if (email.variant === 'first_post') {
    return {
      subject: 'Schedule your first post',
      html: [
        paragraph(
          `You've connected ${escape(
            plural(email.channels, 'channel', 'channels')
          )} to <strong>${escape(
            workspace
          )}</strong>. The next step is your first post:`
        ),
        list(
          [
            'Write it once, then adjust the text for each channel if you like.',
            'Pick a date and time, or save it as a draft.',
            "PostDelegate publishes it at that time, even when you're offline.",
          ],
          true
        ),
        paragraph(
          'Not ready to publish anything real? Schedule it a week out and move it on the calendar later.'
        ),
        emailButton(`${app}/launches`, 'Create a post'),
        muted(
          `New to the composer? ${link(
            `${DOCS}/posts`,
            'Read the posts guide'
          )}.`
        ),
      ].join(''),
    };
  }

  return {
    subject: 'Connect your first channel',
    html: [
      paragraph(
        `Your PostDelegate trial for <strong>${escape(
          workspace
        )}</strong> is under way. The first step is connecting a channel: an account, page or site you want to post to.`
      ),
      paragraph(
        'Some networks take a single sign-in, others ask for an app password or an API key, and most take a minute or two.'
      ),
      emailButton(`${app}/launches?onboarding=true`, 'Connect a channel'),
      muted(
        `Not sure where to start? The ${link(
          `${DOCS}/channels`,
          'channels guide'
        )} lists every network you can connect today, how each one connects and what you can publish to it.`
      ),
    ].join(''),
  };
};

@Injectable()
export class TrialOnboardingService {
  private readonly _logger = new Logger(TrialOnboardingService.name);
  constructor(
    private _trialOnboardingRepository: TrialOnboardingRepository,
    private _emailService: EmailService
  ) {}

  // which email of the step fits the workspace now, if any
  private async pickEmail(
    step: TrialOnboardingStep,
    orgId: string
  ): Promise<TrialOnboardingEmail | undefined> {
    const channels = await this._trialOnboardingRepository.countChannels(orgId);
    if (step === 'day_3') {
      const settings = await this._trialOnboardingRepository.getAgentApproval(
        orgId
      );
      return {
        step,
        channels,
        agentApproval: !!settings?.requireAgentApproval,
      };
    }
    if (!channels) {
      return { step, variant: 'connect_channel' };
    }
    if (!(await this._trialOnboardingRepository.countPosts(orgId))) {
      return { step, variant: 'first_post', channels };
    }
    // a channel and a post already, nothing to nudge
    return undefined;
  }

  // Run every hour by trialOnboardingWorkflowV1: sends each step to the
  // workspaces that reached it in the last day and didn't get it yet
  async sendDueEmails(now = new Date()) {
    if (
      process.env.TRIAL_ONBOARDING_EMAILS_DISABLED === 'true' ||
      !this._emailService.hasProvider()
    ) {
      return { checked: 0, sent: 0 };
    }

    let checked = 0;
    let sent = 0;
    let claimed = 0;
    for (const { step, after } of TRIAL_ONBOARDING_STEPS) {
      const to = new Date(now.getTime() - after * HOUR);
      const from = new Date(
        Math.max(to.getTime() - 24 * HOUR, TRIAL_ONBOARDING_FROM.getTime())
      );
      if (from >= to) {
        continue;
      }

      let cursor: string | undefined;
      while (claimed < RUN_LIMIT) {
        const page = await this._trialOnboardingRepository.getTrials(
          step,
          from,
          to,
          cursor,
          PAGE
        );
        if (!page.length) {
          break;
        }
        cursor = page[page.length - 1].id;
        checked += page.length;

        for (const trial of page) {
          if (claimed >= RUN_LIMIT) {
            break;
          }
          try {
            const email = await this.pickEmail(step, trial.organizationId);
            if (!email) {
              continue;
            }
            const recipients = [
              ...new Set(
                (
                  await this._trialOnboardingRepository.getRecipients(
                    trial.organizationId
                  )
                ).map((member) => member.user.email)
              ),
            ];
            if (!recipients.length) {
              continue;
            }
            if (
              !(await this._trialOnboardingRepository.claimSend(
                trial.organizationId,
                step
              ))
            ) {
              continue;
            }
            claimed++;
            const { subject, html } = trialOnboardingEmail(
              email,
              trial.organization.name
            );
            for (const address of recipients) {
              await this._emailService.sendEmail(
                address,
                subject,
                html,
                'bottom'
              );
            }
            sent++;
          } catch (err) {
            this._logger.warn(
              `Could not send a trial onboarding email. org=${
                trial.organizationId
              } step=${step} code=${
                (err as { code?: string })?.code ||
                (err as Error)?.name ||
                'unknown'
              }`
            );
          }
        }

        if (page.length < PAGE) {
          break;
        }
      }
    }

    return { checked, sent };
  }
}
