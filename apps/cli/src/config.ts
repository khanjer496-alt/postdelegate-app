import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

export const DEFAULT_API_URL = 'https://app.postdelegate.com/api';

export interface StoredConfig {
  apiKey?: string;
  apiUrl?: string;
}

export type CredentialSource = 'flag' | 'env' | 'config' | 'none';

export interface Credentials {
  apiKey?: string;
  apiUrl: string;
  keySource: CredentialSource;
}

export class ConfigError extends Error {}

/** `$XDG_CONFIG_HOME/postdelegate/config.json`, else `~/.config/postdelegate/config.json`. */
export function configPath(
  env: Record<string, string | undefined>,
  homedir: string
) {
  const base = env.XDG_CONFIG_HOME || join(homedir, '.config');
  return join(base, 'postdelegate', 'config.json');
}

export function readConfig(path: string): StoredConfig {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    throw new ConfigError(
      `Could not read ${path}: invalid JSON. Run "postdelegate login" again or delete the file`
    );
  }
}

/** Writes the config with owner-only permissions (dir 0700, file 0600). */
export function writeConfig(path: string, config: StoredConfig) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

export function deleteConfig(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  rmSync(path);
  return true;
}

/** Precedence: command line flag, environment variable, config file. */
export function resolveCredentials(input: {
  flags: { apiKey?: string; apiUrl?: string };
  env: Record<string, string | undefined>;
  config: StoredConfig;
}): Credentials {
  const { flags, env, config } = input;
  const candidates: [string | undefined, CredentialSource][] = [
    [flags.apiKey, 'flag'],
    [env.POSTDELEGATE_API_KEY, 'env'],
    [config.apiKey, 'config'],
  ];
  const found = candidates.find(([key]) => !!key?.trim());

  return {
    apiKey: found?.[0]?.trim(),
    keySource: found ? found[1] : 'none',
    apiUrl: (
      flags.apiUrl ||
      env.POSTDELEGATE_API_URL ||
      config.apiUrl ||
      DEFAULT_API_URL
    ).replace(/\/+$/, ''),
  };
}
