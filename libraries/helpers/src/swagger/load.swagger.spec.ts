const setup = jest.fn();
jest.mock('@nestjs/swagger', () => {
  class DocumentBuilder {
    setTitle() {
      return this;
    }
    setDescription() {
      return this;
    }
    setVersion() {
      return this;
    }
    build() {
      return {};
    }
  }
  return {
    DocumentBuilder,
    SwaggerModule: {
      createDocument: () => ({}),
      setup: (...args: unknown[]) => setup(...args),
    },
  };
});

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadSwagger,
  swaggerEnabled,
} from '@gitroom/helpers/swagger/load.swagger';

describe('swagger', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('is off by default', () => {
    delete process.env.ENABLE_SWAGGER;

    expect(swaggerEnabled()).toBe(false);
  });

  it.each(['false', '1', 'TRUE', 'yes', ''])(
    'stays off when ENABLE_SWAGGER is "%s"',
    (value) => {
      process.env.ENABLE_SWAGGER = value;

      expect(swaggerEnabled()).toBe(false);
    }
  );

  it('is on only with ENABLE_SWAGGER=true', () => {
    process.env.ENABLE_SWAGGER = 'true';

    expect(swaggerEnabled()).toBe(true);
  });

  it('mounts the UI at /docs when loaded', () => {
    loadSwagger({} as any);

    expect(setup).toHaveBeenCalledWith('docs', {}, {});
  });

  it('is only loaded by the backend behind swaggerEnabled()', () => {
    const main = readFileSync(
      join(__dirname, '../../../../apps/backend/src/main.ts'),
      'utf8'
    );

    expect(main).toMatch(
      /if \(swaggerEnabled\(\)\) \{\s*loadSwagger\(app\);\s*\}/
    );
    expect(main.match(/loadSwagger\(app\)/g)).toHaveLength(1);
  });
});
