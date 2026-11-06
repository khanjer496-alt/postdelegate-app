import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AddressInfo } from 'node:net';
import { PublicOpenApiController } from '@gitroom/backend/public-api/routes/v1/public.openapi.controller';

const repoRoot = join(__dirname, '../../../../../..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const spec = JSON.parse(
  read('apps/backend/src/public-api/openapi/public.api.openapi.json')
);

// Routes of the public API controller that are deliberately not in the
// spec: operator-only (super admin) routes, and the AI video and clipping
// routes the docs leave out of the supported surface
const undocumented = [
  'GET /users',
  'GET /debug/posts/{id}',
  'GET /debug/account',
  'GET /debug/channels',
  'GET /debug/activity',
  'POST /credits/reset',
  'POST /generate-video',
  'POST /video/function',
  'POST /clipping',
  'GET /clipping',
  'GET /clipping/{id}',
];

describe('public API OpenAPI document', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicOpenApiController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
  });

  it('is served as JSON with CORS * and no API key', async () => {
    const response = await fetch(`${base}/public/v1/openapi.json`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8'
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual(spec);
  });

  it('is an OpenAPI 3.1 document of the hosted API with bare key auth', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.license).toMatchObject({ name: 'MIT' });
    // the MIT notice of the postiz-docs source travels with every copy
    for (const notice of [spec.info.description, spec.info['x-license-notice']]) {
      expect(notice).toContain('Copyright (c) 2023 Mintlify');
      expect(notice).toContain(
        'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.'
      );
      expect(notice).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    }
    expect(spec.servers).toEqual([
      expect.objectContaining({
        url: 'https://app.postdelegate.com/api/public/v1',
      }),
    ]);
    expect(spec.security).toEqual([{ ApiKeyAuth: [] }]);
    expect(spec.components.securitySchemes.ApiKeyAuth).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
    });
  });

  it('has every $ref resolvable and every tag declared', () => {
    const refs = JSON.stringify(spec).match(/"\$ref":"[^"]+"/g) || [];
    for (const ref of refs) {
      const path = ref.slice('"$ref":"#/'.length, -1).split('/');
      expect(path.reduce((node: any, key) => node?.[key], spec)).toBeDefined();
    }

    const tags = spec.tags.map((tag: { name: string }) => tag.name);
    for (const operations of Object.values<any>(spec.paths)) {
      for (const operation of Object.values<any>(operations)) {
        for (const tag of operation.tags || []) {
          expect(tags).toContain(tag);
        }
      }
    }
  });

  it('documents exactly the supported routes of the public API controller', () => {
    const source = read(
      'apps/backend/src/public-api/routes/v1/public.integrations.controller.ts'
    );
    const routes = [
      ...source.matchAll(/@(Get|Post|Put|Delete|Patch)\('([^']*)'\)/g),
    ].map(
      ([, method, path]) =>
        `${method.toUpperCase()} ${path.replace(/:(\w+)/g, '{$1}')}`
    );
    const documented = Object.entries<any>(spec.paths).flatMap(
      ([path, operations]) =>
        Object.keys(operations).map(
          (method) => `${method.toUpperCase()} ${path}`
        )
    );

    expect(documented.sort()).toEqual(
      routes.filter((route) => !undocumented.includes(route)).sort()
    );
  });

  it('documents a POST as 201, which Nest answers without @HttpCode', () => {
    for (const operations of Object.values<any>(spec.paths)) {
      if (operations.post) {
        expect(Object.keys(operations.post.responses)).toContain('201');
        expect(Object.keys(operations.post.responses)).not.toContain('200');
      }
    }
  });

  // the site copy is not edited by hand: run `pnpm run openapi:sync-site`
  it('is the same file the marketing site serves at /openapi.json', () => {
    expect(read('site/public/openapi.json')).toBe(
      read('apps/backend/src/public-api/openapi/public.api.openapi.json')
    );
    expect(read('site/public/_headers')).toMatch(
      /\/openapi\.json\n\s+Content-Type: application\/json; charset=utf-8\n\s+Access-Control-Allow-Origin: \*/
    );
  });
});
