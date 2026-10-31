import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';

describe('OpenaiService', () => {
  const parse = jest.fn();
  const create = jest.fn();
  const generate = jest.fn();
  let aiCredentialService: { getOpenAiClient: jest.Mock };
  let service: OpenaiService;

  beforeEach(() => {
    parse.mockReset().mockResolvedValue({
      choices: [{ message: { parsed: { posts: ['one'] } } }],
    });
    create.mockReset().mockResolvedValue({
      choices: [{ message: { content: '[{"post":"a"}]' } }],
    });
    generate.mockReset().mockResolvedValue({ data: [{ b64_json: 'abc' }] });
    aiCredentialService = {
      getOpenAiClient: jest.fn().mockResolvedValue({
        chat: { completions: { parse, create } },
        images: { generate },
      }),
    };
    service = new OpenaiService(aiCredentialService as any);
  });

  it('separatePosts asks for the org client', async () => {
    const result = await service.separatePosts('org-1', 'hello world', 280);

    expect(aiCredentialService.getOpenAiClient).toHaveBeenCalledWith('org-1');
    expect(parse).toHaveBeenCalled();
    expect(result).toEqual({ posts: ['one'] });
  });

  it('generateImage asks for the org client', async () => {
    const result = await service.generateImage('org-2', 'a cat', true);

    expect(aiCredentialService.getOpenAiClient).toHaveBeenCalledWith('org-2');
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'a cat', size: '1024x1536' })
    );
    expect(result).toBe('abc');
  });

  it('generatePromptForPicture asks for the org client', async () => {
    parse.mockResolvedValue({
      choices: [{ message: { parsed: { prompt: 'long prompt' } } }],
    });

    expect(await service.generatePromptForPicture('org-3', 'a cat')).toBe(
      'long prompt'
    );
    expect(aiCredentialService.getOpenAiClient).toHaveBeenCalledWith('org-3');
  });

  it('pickClips asks for the org client', async () => {
    parse.mockResolvedValue({
      choices: [{ message: { parsed: { clips: [] } } }],
    });

    await service.pickClips('org-4', 'title', 'en', [], 3);

    expect(aiCredentialService.getOpenAiClient).toHaveBeenCalledWith('org-4');
  });

  it('generatePosts asks for the org client', async () => {
    await service.generatePosts('org-5', 'content');

    expect(aiCredentialService.getOpenAiClient).toHaveBeenCalledWith('org-5');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not touch the OpenAI client when the key is missing', async () => {
    aiCredentialService.getOpenAiClient.mockRejectedValue(
      new Error('Add your OpenAI key in Settings → AI')
    );

    await expect(service.separatePosts('org-1', 'x', 10)).rejects.toThrow(
      'Add your OpenAI key in Settings → AI'
    );
    expect(parse).not.toHaveBeenCalled();
  });
});
