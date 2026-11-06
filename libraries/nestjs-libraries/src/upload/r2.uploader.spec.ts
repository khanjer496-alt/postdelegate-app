const send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const command = (name: string) =>
    class {
      constructor(public input: any) {
        (this as any).name = name;
      }
    };
  return {
    S3Client: class {
      send = send;
    },
    UploadPartCommand: command('UploadPart'),
    ListPartsCommand: command('ListParts'),
    CreateMultipartUploadCommand: command('CreateMultipartUpload'),
    CompleteMultipartUploadCommand: command('CompleteMultipartUpload'),
    AbortMultipartUploadCommand: command('AbortMultipartUpload'),
    PutObjectCommand: command('PutObject'),
    GetObjectCommand: command('GetObject'),
    DeleteObjectCommand: command('DeleteObject'),
  };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/part'),
}));
jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn().mockResolvedValue({ mime: 'image/png' }),
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { processorEnabled: () => false },
}));
const store = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => store.delete(key)),
  },
}));

import handleR2Upload from '@gitroom/nestjs-libraries/upload/r2.uploader';

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  return res;
};

const create = async (orgId: string) => {
  send.mockImplementationOnce(async (command: any) => ({
    UploadId: 'upload-1',
    Key: command.input.Key,
  }));
  const res = makeRes();
  await handleR2Upload(
    'create-multipart-upload',
    { body: { file: { name: 'a.png' }, fileHash: 'h' } } as any,
    res,
    orgId
  );
  return res.json.mock.calls[0][0] as { uploadId: string; key: string };
};

describe('R2 multipart upload ownership', () => {
  beforeEach(() => {
    store.clear();
    send.mockReset();
  });

  it('lets the creating organization continue its own upload', async () => {
    const { key, uploadId } = await create('org-A');
    const res = makeRes();

    await handleR2Upload(
      'sign-part',
      { body: { key, uploadId, partNumber: '1' } } as any,
      res,
      'org-A'
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each([
    ['sign-part', (k: string, u: string) => ({ key: k, uploadId: u, partNumber: '1' })],
    ['list-parts', (k: string, u: string) => ({ key: k, uploadId: u })],
    ['abort-multipart-upload', (k: string, u: string) => ({ key: k, uploadId: u })],
    ['complete-multipart-upload', (k: string, u: string) => ({ key: k, uploadId: u, parts: [] })],
    ['prepare-upload-parts', (k: string, u: string) => ({ partData: { key: k, uploadId: u, parts: [{ number: 1 }] } })],
  ])('refuses %s from another organization without touching the bucket', async (endpoint, body) => {
    const { key, uploadId } = await create('org-A');
    send.mockClear();
    const res = makeRes();

    await handleR2Upload(endpoint, { body: body(key, uploadId) } as any, res, 'org-B');

    expect(res.status).toHaveBeenCalledWith(404);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a key the server never issued and a mismatched upload id', async () => {
    const { key } = await create('org-A');
    send.mockClear();

    const unknown = makeRes();
    await handleR2Upload(
      'abort-multipart-upload',
      { body: { key: 'someone-elses-object.mp4', uploadId: 'x' } } as any,
      unknown,
      'org-A'
    );
    expect(unknown.status).toHaveBeenCalledWith(404);

    const mismatch = makeRes();
    await handleR2Upload(
      'abort-multipart-upload',
      { body: { key, uploadId: 'other-upload' } } as any,
      mismatch,
      'org-A'
    );
    expect(mismatch.status).toHaveBeenCalledWith(404);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects out-of-range part numbers', async () => {
    const { key, uploadId } = await create('org-A');

    for (const partNumber of ['0', '-1', '10001', 'abc']) {
      const res = makeRes();
      await handleR2Upload(
        'sign-part',
        { body: { key, uploadId, partNumber } } as any,
        res,
        'org-A'
      );
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  it('deletes an assembled object that exceeds the size cap', async () => {
    const { key, uploadId } = await create('org-A');
    send.mockClear();
    send
      .mockResolvedValueOnce({ Location: `https://r2/${key}` }) // complete
      .mockResolvedValueOnce({
        Body: [Buffer.from('png')],
        ContentRange: `bytes 0-4100/${11 * 1024 * 1024}`, // image cap is 10 MB
      }) // ranged get
      .mockResolvedValueOnce({}); // delete
    const res = makeRes();

    await handleR2Upload(
      'complete-multipart-upload',
      { body: { key, uploadId, parts: [] } } as any,
      res,
      'org-A'
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'File is too large.' });
    expect(send.mock.calls.at(-1)![0].name).toBe('DeleteObject');
  });
});
