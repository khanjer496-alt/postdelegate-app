import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BillingExtraChannelsDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.extra.channels.dto';

describe('BillingExtraChannelsDto', () => {
  const errors = async (extraChannels: unknown) =>
    validate(plainToInstance(BillingExtraChannelsDto, { extraChannels }));

  it.each([0, 1, 900])('accepts %s extra channels', async (extraChannels) => {
    expect(await errors(extraChannels)).toEqual([]);
  });

  it.each([-1, 901, 2.5, '10', undefined])(
    'rejects %s',
    async (extraChannels) => {
      expect(await errors(extraChannels)).toHaveLength(1);
    }
  );
});
