jest.mock('@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service', () => ({ AutopostService: class {} }));
jest.mock('@gitroom/backend/services/auth/permissions/permissions.service', () => ({ PermissionsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto', () => ({ OnlyURL: class {} }));

import { AutopostController } from './autopost.controller';
import {
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

const make = (allowed: Sections[]) => {
  const autoposts = {
    changeActive: jest.fn(async () => ({})),
    createAutopost: jest.fn(async () => ({})),
  };
  const permissions = {
    allows: jest.fn(async (_o: string, _d: Date, section: Sections) =>
      allowed.includes(section)
    ),
  };
  const controller = new AutopostController(autoposts as any, permissions as any);
  const org = { id: 'org-1', createdAt: new Date() } as any;
  return { controller, autoposts, permissions, org };
};

describe('AutopostController plan gate', () => {
  it('always lets a feed be turned off, without the plan or an AI key', async () => {
    const { controller, autoposts, permissions, org } = make([]);
    await controller.changeActive(org, 'a1', false);
    expect(autoposts.changeActive).toHaveBeenCalledWith('org-1', 'a1', false);
    expect(permissions.allows).not.toHaveBeenCalled();
  });

  it('refuses turning a feed on without AutoPost in the plan', async () => {
    const { controller, autoposts, org } = make([Sections.AI]);
    await expect(controller.changeActive(org, 'a1', true)).rejects.toBeInstanceOf(
      SubscriptionException
    );
    expect(autoposts.changeActive).not.toHaveBeenCalled();
  });

  it('turns a feed on with the plan and an AI key', async () => {
    const { controller, autoposts, org } = make([Sections.AI, Sections.AUTO_POST]);
    await controller.changeActive(org, 'a1', true);
    expect(autoposts.changeActive).toHaveBeenCalledWith('org-1', 'a1', true);
  });

  it('saves an inactive feed without the plan, refuses an active one', async () => {
    const { controller, autoposts, org } = make([Sections.AI]);
    await controller.updateAutopost(org, { active: false } as any, 'a1');
    expect(autoposts.createAutopost).toHaveBeenCalledTimes(1);
    await expect(
      controller.updateAutopost(org, { active: true } as any, 'a1')
    ).rejects.toBeInstanceOf(SubscriptionException);
  });
});
