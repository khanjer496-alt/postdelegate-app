// file-type is an ES module jest can't load here, and streaming never uses it
jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }));

import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { LocalStorage } from '@gitroom/nestjs-libraries/upload/local.storage';

describe('LocalStorage.uploadStream', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'local-storage-'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores an m4a, the type Studio music sniffs as', async () => {
    const uploaded = await new LocalStorage(dir).uploadStream(
      Readable.from([Buffer.from('m4a')]),
      'audio/x-m4a',
      'm4a'
    );
    expect(uploaded.mimetype).toBe('audio/x-m4a');
    expect(uploaded.filename).toMatch(/\.m4a$/);
  });

  it('still refuses a type nothing uploads', async () => {
    await expect(
      new LocalStorage(dir).uploadStream(
        Readable.from([Buffer.from('x')]),
        'application/x-msdownload',
        'exe'
      )
    ).rejects.toThrow('Unsupported file type.');
    expect(readdirSync(dir)).toHaveLength(0);
  });
});
