import {
  TRIAL_ONBOARDING_FROM,
  TrialOnboardingService,
  trialOnboardingEmail,
} from '@gitroom/nestjs-libraries/database/prisma/trial-onboarding/trial.onboarding.service';

const HOUR = 60 * 60 * 1000;
const now = new Date(TRIAL_ONBOARDING_FROM.getTime() + 30 * 24 * HOUR);

describe('trialOnboardingEmail', () => {
  it('asks for a channel first and escapes the workspace', () => {
    const { subject, html } = trialOnboardingEmail(
      { step: 'day_1', variant: 'connect_channel' },
      'Acme <Team>',
      'https://app.test'
    );
    expect(subject).toBe('Connect your first channel');
    expect(html).toContain('Acme &lt;Team&gt;');
    expect(html).toContain('https://app.test/launches?onboarding=true');
    expect(html).toContain('https://postdelegate.com/docs/channels');
  });

  it('moves on to the first post once a channel is connected', () => {
    const { subject, html } = trialOnboardingEmail(
      { step: 'day_1', variant: 'first_post', channels: 1 },
      'Acme',
      'https://app.test'
    );
    expect(subject).toBe('Schedule your first post');
    expect(html).toContain('1 channel ');
    expect(html).toContain('https://app.test/launches');
  });

  it('points to the connectors, approvals and Settings > AI on day 3', () => {
    const { subject, html } = trialOnboardingEmail(
      { step: 'day_3', channels: 2, agentApproval: true },
      'Acme',
      'https://app.test'
    );
    expect(subject).toBe('Let Claude or ChatGPT draft a week of posts');
    expect(html).toContain('https://postdelegate.com/docs/mcp/claude');
    expect(html).toContain('https://postdelegate.com/docs/mcp/chatgpt');
    expect(html).toContain('plans that support custom connectors');
    expect(html).toContain('https://postdelegate.com/docs/approvals');
    expect(html).toContain('https://app.test/settings?tab=ai');
    expect(html).toContain('Nothing goes out without you');
    expect(html).not.toContain('connect a channel');
  });

  it('only promises approval when the workspace requires it', () => {
    const { html } = trialOnboardingEmail(
      { step: 'day_3', channels: 2, agentApproval: false },
      'Acme'
    );
    expect(html).not.toContain('Nothing goes out without you');
    expect(html).toContain('Require approval for AI-created posts');
  });

  it('asks for a channel first on day 3 when there is none', () => {
    const { html } = trialOnboardingEmail(
      { step: 'day_3', channels: 0, agentApproval: true },
      'Acme',
      'https://app.test'
    );
    expect(html.indexOf('connect a channel')).toBeLessThan(
      html.indexOf('Claude')
    );
    expect(html).toContain('https://app.test/launches?onboarding=true');
  });

  it('never says Postiz or open source', () => {
    const all = [
      trialOnboardingEmail({ step: 'day_1', variant: 'connect_channel' }, 'A'),
      trialOnboardingEmail(
        { step: 'day_1', variant: 'first_post', channels: 2 },
        'A'
      ),
      trialOnboardingEmail(
        { step: 'day_3', channels: 0, agentApproval: false },
        'A'
      ),
      trialOnboardingEmail(
        { step: 'day_3', channels: 1, agentApproval: true },
        'A'
      ),
    ];
    for (const { subject, html } of all) {
      expect(`${subject} ${html}`).not.toMatch(/postiz|open source/i);
    }
  });
});

describe('TrialOnboardingService.sendDueEmails', () => {
  const trial = (orgId: string) => ({
    id: `sub-${orgId}`,
    organizationId: orgId,
    organization: { name: 'Acme' },
  });

  const make = () => {
    const repo = {
      getTrials: jest.fn().mockResolvedValue([]),
      getRecipients: jest.fn(async (orgId: string) => [
        { user: { email: `${orgId}@test.com` } },
        // one person who is an admin through two logins
        { user: { email: `${orgId}@test.com` } },
      ]),
      countChannels: jest.fn().mockResolvedValue(0),
      countPosts: jest.fn().mockResolvedValue(0),
      getAgentApproval: jest
        .fn()
        .mockResolvedValue({ requireAgentApproval: true }),
      claimSend: jest.fn().mockResolvedValue(true),
    };
    const email = {
      hasProvider: jest.fn().mockReturnValue(true),
      sendEmail: jest.fn(),
    };
    const service = new TrialOnboardingService(repo as any, email as any);
    return { service, repo, email };
  };

  it('looks for each step one day wide, from its hour into the trial', async () => {
    const { service, repo } = make();
    await service.sendDueEmails(now);

    const [day1, day3] = repo.getTrials.mock.calls;
    expect(day1[0]).toBe('day_1');
    expect(day1[2].getTime()).toBe(now.getTime() - 24 * HOUR);
    expect(day1[1].getTime()).toBe(now.getTime() - 48 * HOUR);
    expect(day3[0]).toBe('day_3');
    expect(day3[2].getTime()).toBe(now.getTime() - 72 * HOUR);
    expect(day3[1].getTime()).toBe(now.getTime() - 96 * HOUR);
  });

  it('never looks at trials that started before the series shipped', async () => {
    const { service, repo } = make();
    await service.sendDueEmails(
      new Date(TRIAL_ONBOARDING_FROM.getTime() + 30 * HOUR)
    );

    expect(repo.getTrials).toHaveBeenCalledTimes(1);
    const [step, from, to] = repo.getTrials.mock.calls[0];
    expect(step).toBe('day_1');
    expect(from.getTime()).toBe(TRIAL_ONBOARDING_FROM.getTime());
    expect(to.getTime()).toBe(TRIAL_ONBOARDING_FROM.getTime() + 6 * HOUR);
  });

  it('sends once per address to the workspaces it could claim', async () => {
    const { service, repo, email } = make();
    repo.getTrials.mockImplementation(async (step: string) =>
      step === 'day_1' ? [trial('a'), trial('b')] : []
    );
    repo.claimSend.mockImplementation(async (orgId: string) => orgId !== 'b');

    expect(await service.sendDueEmails(now)).toEqual({ checked: 2, sent: 1 });
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0]).toBe('a@test.com');
    expect(email.sendEmail.mock.calls[0][1]).toBe('Connect your first channel');
    expect(email.sendEmail.mock.calls[0][3]).toBe('bottom');
    expect(repo.claimSend).toHaveBeenCalledWith('a', 'day_1');
  });

  it('picks the first post email, or none, from the channels and posts', async () => {
    const { service, repo, email } = make();
    repo.getTrials.mockImplementation(async (step: string) =>
      step === 'day_1' ? [trial('a'), trial('b')] : []
    );
    repo.countChannels.mockResolvedValue(2);
    repo.countPosts.mockImplementation(async (orgId: string) =>
      orgId === 'a' ? 0 : 3
    );

    await service.sendDueEmails(now);

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][1]).toBe('Schedule your first post');
    expect(repo.claimSend).toHaveBeenCalledTimes(1);
  });

  it('claims nothing when every admin switched the emails off', async () => {
    const { service, repo, email } = make();
    repo.getTrials.mockImplementation(async (step: string) =>
      step === 'day_3' ? [trial('a')] : []
    );
    repo.getRecipients.mockResolvedValue([]);

    await service.sendDueEmails(now);

    expect(repo.claimSend).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('keeps going after a failing workspace', async () => {
    const { service, repo, email } = make();
    repo.getTrials.mockImplementation(async (step: string) =>
      step === 'day_3' ? [trial('a'), trial('b')] : []
    );
    repo.getRecipients.mockImplementation(async (orgId: string) => {
      if (orgId === 'a') {
        throw new Error('db');
      }
      return [{ user: { email: 'b@test.com' } }];
    });
    const warn = jest
      .spyOn((service as any)._logger, 'warn')
      .mockImplementation(() => undefined);

    expect(await service.sendDueEmails(now)).toEqual({ checked: 2, sent: 1 });
    expect(email.sendEmail.mock.calls[0][1]).toBe(
      'Let Claude or ChatGPT draft a week of posts'
    );
    // the org and the error code, never an address
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('org=a step=day_3 code=Error')
    );
    expect(warn.mock.calls[0][0]).not.toContain('@');
  });

  it('reads the approval policy, a workspace without settings has none', async () => {
    const { service, repo, email } = make();
    repo.getTrials.mockImplementation(async (step: string) =>
      step === 'day_3' ? [trial('a')] : []
    );
    repo.countChannels.mockResolvedValue(1);
    repo.getAgentApproval.mockResolvedValue(null);

    await service.sendDueEmails(now);

    expect(repo.getAgentApproval).toHaveBeenCalledWith('a');
    expect(email.sendEmail.mock.calls[0][2]).toContain(
      'Require approval for AI-created posts'
    );
  });

  it('does nothing without an email provider or when switched off', async () => {
    const { service, repo, email } = make();
    email.hasProvider.mockReturnValue(false);
    expect(await service.sendDueEmails(now)).toEqual({ checked: 0, sent: 0 });

    email.hasProvider.mockReturnValue(true);
    process.env.TRIAL_ONBOARDING_EMAILS_DISABLED = 'true';
    try {
      expect(await service.sendDueEmails(now)).toEqual({ checked: 0, sent: 0 });
    } finally {
      delete process.env.TRIAL_ONBOARDING_EMAILS_DISABLED;
    }
    expect(repo.getTrials).not.toHaveBeenCalled();
  });
});
