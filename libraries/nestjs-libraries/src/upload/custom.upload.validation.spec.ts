// file-type is an ES module jest can't load here; this stand-in sniffs the
// same few signatures, so the spec checks which types each route lets in
jest.mock('file-type', () => ({
  fileTypeStream: async (stream: ReadableStream) => {
    const reader = stream.getReader();
    const { value } = await reader.read();
    const head = Buffer.from(value);
    const fileType = head.subarray(0, 3).toString() === 'ID3'
      ? { mime: 'audio/mpeg', ext: 'mp3' }
      : head.subarray(8, 12).toString() === 'WAVE'
      ? { mime: 'audio/wav', ext: 'wav' }
      : head[1] === 0x50 && head[2] === 0x4e
      ? { mime: 'image/png', ext: 'png' }
      : head.subarray(4, 11).toString() === 'ftypM4A'
      ? { mime: 'audio/x-m4a', ext: 'm4a' }
      : head.subarray(4, 8).toString() === 'ftyp'
      ? { mime: 'video/mp4', ext: 'mp4' }
      : undefined;
    const rest = new ReadableStream({
      start(controller) {
        controller.enqueue(value);
        controller.close();
      },
    });
    return Object.assign(rest, { fileType });
  },
}));

import { Readable } from 'stream';
import { BadRequestException } from '@nestjs/common';
import { uploadStreamToStorage } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { STUDIO_MUSIC_UPLOAD } from '@gitroom/nestjs-libraries/dtos/studio/studio.music.dto';

// a few bytes that sniff as each type
const MP3 = Buffer.concat([
  Buffer.from('ID3'),
  Buffer.from([4, 0, 0, 0, 0, 0, 0]),
  Buffer.alloc(4096, 0),
]);
const WAV = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WAVEfmt '),
  Buffer.alloc(4096, 0),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from('IHDR'),
  Buffer.alloc(4096, 0),
]);
const M4A = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypM4A '),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('M4A mp42'),
  Buffer.alloc(4096, 0),
]);
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypmp42'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('mp42isom'),
  Buffer.alloc(4096, 0),
]);

const web = (buffer: Buffer) => Readable.toWeb(Readable.from([buffer])) as any;

describe('uploadStreamToStorage rules', () => {
  const storage = () => ({
    uploadStream: jest.fn(async (stream: Readable, mimetype: string, ext: string) => {
      for await (const _chunk of stream) {
        /** drain **/
      }
      return { filename: `a.${ext}`, path: `https://cdn/a.${ext}`, mimetype, originalname: '' };
    }),
  });

  it.each([
    ['mp3', MP3, 'audio/mpeg'],
    ['wav', WAV, 'audio/wav'],
    ['m4a', M4A, 'audio/x-m4a'],
  ])('takes %s as Studio music', async (_name, buffer, mime) => {
    const provider = storage();
    const uploaded = await uploadStreamToStorage(
      provider as any,
      web(buffer),
      0,
      STUDIO_MUSIC_UPLOAD
    );
    expect(uploaded.mimetype).toBe(mime);
  });

  it.each([
    ['a picture', PNG],
    ['an mp4 video', MP4],
  ])('refuses %s as Studio music', async (_name, buffer) => {
    const provider = storage();
    await expect(
      uploadStreamToStorage(provider as any, web(buffer), 0, STUDIO_MUSIC_UPLOAD)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.uploadStream).not.toHaveBeenCalled();
  });

  it('tells why an m4a with an mp4 brand is refused', async () => {
    await expect(
      uploadStreamToStorage(storage() as any, web(MP4), 0, STUDIO_MUSIC_UPLOAD)
    ).rejects.toThrow('An M4A saved as an MP4 video is refused');
  });

  it('refuses music over 30 MB as soon as the size says so', async () => {
    const provider = storage();
    await expect(
      uploadStreamToStorage(
        provider as any,
        web(MP3),
        30 * 1024 * 1024 + 1,
        STUDIO_MUSIC_UPLOAD
      )
    ).rejects.toThrow('File is too large.');
  });

  it('keeps the media library rules when a route gives none', async () => {
    const provider = storage();
    await expect(
      uploadStreamToStorage(provider as any, web(MP3))
    ).rejects.toThrow('Unsupported file type.');
    await expect(
      uploadStreamToStorage(provider as any, web(PNG))
    ).resolves.toMatchObject({ ext: 'png' });
  });
});
