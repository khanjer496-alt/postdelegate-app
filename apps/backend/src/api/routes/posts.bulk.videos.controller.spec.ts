// the real services pull in every social provider, the spec only needs the shape
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.bulk.videos.service', () => ({
  PostsBulkVideosService: class {},
}));
jest.mock('@gitroom/backend/services/auth/permissions/permissions.service', () => ({
  PermissionsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service', () => ({
  userActor: (user: any) => ({ type: 'user', userId: user.id }),
}));

import { SubscriptionException } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { PostsBulkVideosController } from './posts.bulk.videos.controller';

describe('PostsBulkVideosController', () => {
  const org: any = { id: 'org-1', createdAt: new Date(), users: [{ role: 'ADMIN' }] };
  const user: any = { id: 'u-1' };
  const body: any = { type: 'schedule', videos: [{ mediaId: 'm-1' }] };

  const make = (status: 'none' | 'running' | 'done', allowed: boolean) => {
    const service = {
      status: jest.fn().mockResolvedValue({ key: 'k', status }),
      statusOf: jest.fn().mockResolvedValue({ status }),
      create: jest.fn().mockResolvedValue({ created: 1 }),
    };
    const permissions = {
      check: jest.fn().mockResolvedValue({ can: () => allowed }),
      remainingPostsThisMonth: jest.fn().mockResolvedValue(0),
    };
    return {
      controller: new PostsBulkVideosController(service as any, permissions as any),
      service,
      permissions,
    };
  };

  it('checks the monthly posts of the plan for a request never sent', async () => {
    const { controller, service } = make('none', false);
    await expect(controller.create(org, user, body)).rejects.toBeInstanceOf(
      SubscriptionException
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each(['running', 'done'] as const)(
    'lets a %s request through without the plan check, for its 409 or result',
    async (status) => {
      const { controller, service, permissions } = make(status, false);
      expect(await controller.create(org, user, body)).toEqual({ created: 1 });
      expect(permissions.check).not.toHaveBeenCalled();
      expect(service.create).toHaveBeenCalledWith('org-1', body, 0, expect.anything());
    }
  );

  it('creates a new request when the plan allows it', async () => {
    const { controller, service, permissions } = make('none', true);
    await controller.create(org, user, body);
    expect(permissions.check.mock.calls[0][3]).toEqual([['create', 'posts_per_month']]);
    expect(service.create).toHaveBeenCalled();
  });

  it('reads the status without any plan check, by body then by key', async () => {
    const { controller, service, permissions } = make('running', false);
    expect(await controller.status(org, body)).toEqual({ key: 'k', status: 'running' });
    expect(await controller.statusOf(org, 'k')).toEqual({ status: 'running' });
    expect(service.statusOf).toHaveBeenCalledWith('org-1', 'k');
    expect(permissions.check).not.toHaveBeenCalled();
  });
});
