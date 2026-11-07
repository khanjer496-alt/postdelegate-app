import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';

describe('BillingSubscribeDto', () => {
  const pulseVisitor = (pulse_vid: unknown) =>
    plainToInstance(BillingSubscribeDto, {
      billing: 'STANDARD',
      period: 'MONTHLY',
      pulse_vid,
    }).pulse_vid;

  it('keeps a Pulse visitor id', () => {
    expect(pulseVisitor('0123456789abcdef0123456789abcdef')).toBe(
      '0123456789abcdef0123456789abcdef'
    );
  });

  it.each([
    '0123456789ABCDEF0123456789ABCDEF',
    '0123456789abcdef',
    '0123456789abcdef0123456789abcdef0',
    'x123456789abcdef0123456789abcdef',
    '<script>',
    12,
    ['0123456789abcdef0123456789abcdef'],
    undefined,
  ])('drops %p', (value) => {
    expect(pulseVisitor(value)).toBeUndefined();
  });
});
