import 'reflect-metadata';
import {
  isAttachablePath,
  ValidUrlExtension,
} from '@gitroom/helpers/utils/valid.url.path';

describe('isAttachablePath', () => {
  // the composer greys out what POST /posts refuses with ValidUrlExtension
  it.each([
    ['https://cdn.example/a.png', true],
    ['https://cdn.example/a.webp?x=1', true],
    ['https://cdn.example/a.mp4', true],
    ['https://cdn.example/a.avif', false],
    ['https://cdn.example/a.bmp', false],
    ['https://cdn.example/a.tiff', false],
  ])('%s -> %s, the same answer as ValidUrlExtension', (path, expected) => {
    expect(isAttachablePath(path)).toBe(expected);
    expect(new ValidUrlExtension().validate(path, {} as any)).toBe(expected);
  });
});
