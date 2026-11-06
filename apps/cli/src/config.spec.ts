import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ConfigError,
  DEFAULT_API_URL,
  configPath,
  deleteConfig,
  readConfig,
  resolveCredentials,
  writeConfig,
} from './config';

const posix = process.platform !== 'win32';

describe('config file', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdz-cli-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('resolves ~/.config/postdelegate/config.json and honours XDG_CONFIG_HOME', () => {
    expect(configPath({}, '/home/me')).toBe('/home/me/.config/postdelegate/config.json');
    expect(configPath({ XDG_CONFIG_HOME: '/x' }, '/home/me')).toBe('/x/postdelegate/config.json');
  });

  (posix ? it : it.skip)('writes the file as 0600 inside a 0700 directory', () => {
    const path = configPath({ XDG_CONFIG_HOME: dir }, '/unused');
    writeConfig(path, { apiKey: 'secret', apiUrl: 'https://example.test/api' });

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'postdelegate')).mode & 0o777).toBe(0o700);
    expect(readConfig(path)).toEqual({ apiKey: 'secret', apiUrl: 'https://example.test/api' });
  });

  (posix ? it : it.skip)('tightens the permissions of a file that already exists', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, '{}', { mode: 0o644 });
    writeConfig(path, { apiKey: 'secret' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('leaves no temp file behind and deletes on logout', () => {
    const path = join(dir, 'postdelegate', 'config.json');
    writeConfig(path, { apiKey: 'k' });
    expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false);
    expect(deleteConfig(path)).toBe(true);
    expect(deleteConfig(path)).toBe(false);
    expect(readConfig(path)).toEqual({});
  });

  it('reports an invalid config file', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, '{nope');
    expect(() => readConfig(path)).toThrow(ConfigError);
    expect(readFileSync(path, 'utf8')).toBe('{nope');
  });
});

describe('resolveCredentials', () => {
  const config = { apiKey: 'from-config', apiUrl: 'https://config.test/api/' };

  it('prefers flags, then env, then the config file', () => {
    expect(
      resolveCredentials({
        flags: { apiKey: 'flag', apiUrl: 'https://flag.test/api' },
        env: { POSTDELEGATE_API_KEY: 'env', POSTDELEGATE_API_URL: 'https://env.test/api' },
        config,
      })
    ).toEqual({ apiKey: 'flag', keySource: 'flag', apiUrl: 'https://flag.test/api' });

    expect(
      resolveCredentials({ flags: {}, env: { POSTDELEGATE_API_KEY: 'env' }, config })
    ).toMatchObject({ apiKey: 'env', keySource: 'env', apiUrl: 'https://config.test/api' });

    expect(resolveCredentials({ flags: {}, env: {}, config })).toMatchObject({
      apiKey: 'from-config',
      keySource: 'config',
    });
  });

  it('falls back to the production URL and reports a missing key', () => {
    expect(resolveCredentials({ flags: {}, env: {}, config: {} })).toEqual({
      apiKey: undefined,
      keySource: 'none',
      apiUrl: DEFAULT_API_URL,
    });
  });
});
