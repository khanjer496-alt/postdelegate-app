jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import {
  EmailService,
  emailButton,
} from '@gitroom/nestjs-libraries/services/email.service';

describe('EmailService layout', () => {
  const provider = { sendEmail: jest.fn().mockResolvedValue({}) };
  const service = new EmailService({} as any);
  service.emailService = provider as any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.com';
    process.env.EMAIL_FROM_NAME = 'PostDelegate';
    process.env.FRONTEND_URL = 'https://app.example.com';
  });

  it('puts the body and its button inside the branded frame', async () => {
    await service.sendEmailSync(
      'a@b.com',
      'Activate your account',
      'Hello' + emailButton('https://app.example.com/x', 'Go')
    );

    const html = provider.sendEmail.mock.calls[0][2];
    expect(html).toContain('PostDelegate');
    expect(html).toContain('href="https://app.example.com/x"');
    expect(html).toContain('class="pd-btn"');
    expect(html).toContain('https://app.example.com/settings');
  });

  it('escapes the subject', async () => {
    await service.sendEmailSync('a@b.com', '<b>Acme</b> & co', 'Hi');

    const html = provider.sendEmail.mock.calls[0][2];
    expect(html).toContain('&lt;b&gt;Acme&lt;/b&gt; &amp; co');
    expect(html).not.toContain('<b>Acme</b>');
  });

  it('escapes the button label', () => {
    expect(emailButton('https://x', '<i>x</i>')).toContain(
      '&lt;i&gt;x&lt;/i&gt;'
    );
  });
});
