// the real services pull in storage, Temporal and every social provider, the
// spec only needs their shape
jest.mock('@gitroom/nestjs-libraries/database/prisma/studio/studio.service', () => ({
  StudioService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/studio/studio.schedule.service',
  () => ({ StudioScheduleService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/studio/studio.ai.service',
  () => ({ StudioAiService: class {} })
);
jest.mock('@gitroom/backend/services/auth/permissions/permissions.service', () => ({
  PermissionsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service', () => ({
  userActor: (user: any) => ({ type: 'user', userId: user.id }),
}));
jest.mock('@gitroom/nestjs-libraries/upload/multer.stream.engine', () => ({
  streamUploadOptions: () => ({}),
}));

import { BadRequestException } from '@nestjs/common';
import { SubscriptionException } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { StudioController } from './studio.controller';

describe('StudioController', () => {
  const org: any = { id: 'org-1', createdAt: new Date(), users: [{ role: 'ADMIN' }] };
  const user: any = { id: 'u-1' };
  const body: any = {
    renderIds: ['3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f'],
    integrations: [{ id: 'channel-1' }],
    content: 'New video',
  };

  const make = (
    allowed: boolean,
    remaining: number | null = 4,
    status: 'none' | 'running' | 'done' = 'none'
  ) => {
    const studio = {
      saveAsset: jest.fn().mockResolvedValue({ id: 'asset-1' }),
    };
    const schedule = {
      status: jest.fn().mockResolvedValue({ key: 'k', status }),
      scheduleRenders: jest.fn().mockResolvedValue({ created: 1 }),
    };
    const permissions = {
      check: jest.fn().mockResolvedValue({ can: () => allowed }),
      remainingPostsThisMonth: jest.fn().mockResolvedValue(remaining),
    };
    return {
      controller: new StudioController(
        studio as any,
        schedule as any,
        permissions as any,
        {} as any
      ),
      studio,
      schedule,
      permissions,
    };
  };

  it('checks the monthly posts of the plan before scheduling renders', async () => {
    const { controller, schedule } = make(false);
    await expect(
      controller.scheduleRenders(org, user, body)
    ).rejects.toBeInstanceOf(SubscriptionException);
    expect(schedule.scheduleRenders).not.toHaveBeenCalled();
  });

  it('schedules for the request workspace with the posts left this month', async () => {
    const { controller, schedule, permissions } = make(true, 3);
    expect(await controller.scheduleRenders(org, user, body)).toEqual({
      created: 1,
    });
    expect(permissions.check.mock.calls[0][3]).toEqual([
      ['create', 'posts_per_month'],
    ]);
    expect(schedule.scheduleRenders).toHaveBeenCalledWith('org-1', body, 3, {
      type: 'user',
      userId: 'u-1',
    });
  });

  it('lets a request sent before through without the plan check, for its result', async () => {
    const { controller, schedule, permissions } = make(false, 0, 'done');
    expect(await controller.scheduleRenders(org, user, body)).toEqual({
      created: 1,
    });
    expect(permissions.check).not.toHaveBeenCalled();
    expect(schedule.scheduleRenders).toHaveBeenCalled();
  });

  it('saves an uploaded music file for the request workspace', async () => {
    const { controller, studio } = make(true);
    const file: any = { filename: 'a.mp3', path: 'https://cdn/a.mp3' };
    await controller.uploadAsset(org, file);
    expect(studio.saveAsset).toHaveBeenCalledWith('org-1', file);
    expect(() => controller.uploadAsset(org, undefined as any)).toThrow(
      BadRequestException
    );
  });
});

describe('StudioController AI routes', () => {
  const proto: any = StudioController.prototype;

  // every one of them spends the workspace's own OpenAI credit
  it.each(['transcribe', 'writeScript', 'voiceover'])(
    '%s is limited to 30 an hour per client address',
    (name) => {
      expect(Reflect.getMetadata('__guards__', proto[name])).toContain(
        ThrottlerRealIpGuard
      );
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto[name])).toBe(
        30
      );
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', proto[name])).toBe(
        60 * 60 * 1000
      );
    }
  );

  it('routes the script and the voice of a project', () => {
    expect(Reflect.getMetadata('path', proto.writeScript)).toBe(
      '/projects/:id/ai-script'
    );
    expect(Reflect.getMetadata('path', proto.voiceover)).toBe(
      '/projects/:id/voiceover'
    );
    expect(Reflect.getMetadata('path', proto.getAi)).toBe('/ai');
  });

  it('hands the organization of the request to the AI service', async () => {
    const ai = {
      getCapabilities: jest.fn().mockResolvedValue({ connected: false }),
      writeScript: jest.fn().mockResolvedValue({ script: {} }),
      voiceover: jest.fn().mockResolvedValue({ path: 'p', seconds: 3 }),
    };
    const controller = new StudioController(
      {} as any,
      {} as any,
      {} as any,
      ai as any
    );
    const org = { id: 'org-1' } as any;

    await controller.getAi(org);
    await controller.writeScript(org, 'project-1');
    await controller.voiceover(org, 'project-1');
    expect(ai.getCapabilities).toHaveBeenCalledWith('org-1');
    expect(ai.writeScript).toHaveBeenCalledWith('org-1', 'project-1');
    expect(ai.voiceover).toHaveBeenCalledWith('org-1', 'project-1');
  });
});

// The list hides projects of assistants and the public API unless asked
describe('StudioController.getProjects', () => {
  const { ValidationPipe } = jest.requireActual('@nestjs/common');
  const { GetStudioProjectsDto } = jest.requireActual(
    '@gitroom/nestjs-libraries/dtos/studio/studio.project.dto'
  );
  const query = (value: Record<string, string>) =>
    new ValidationPipe({ transform: true }).transform(value, {
      type: 'query',
      metatype: GetStudioProjectsDto,
    });

  it('asks for the app projects only by default', async () => {
    const getProjects = jest.fn().mockResolvedValue([]);
    const controller = new StudioController(
      { getProjects } as any,
      {} as any,
      {} as any,
      {} as any
    );
    const org = { id: 'org-1' } as any;

    await controller.getProjects(org, await query({}));
    await controller.getProjects(org, await query({ api: 'false' }));
    await controller.getProjects(org, await query({ api: 'true' }));

    expect(getProjects.mock.calls).toEqual([
      ['org-1', false],
      ['org-1', false],
      ['org-1', true],
    ]);
  });
});
