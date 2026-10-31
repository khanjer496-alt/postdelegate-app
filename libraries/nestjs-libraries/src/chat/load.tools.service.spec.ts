const agentConfigs: any[] = [];
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(config: unknown) {
      agentConfigs.push(config);
    }
  },
}));
jest.mock('@mastra/memory', () => ({ Memory: class {} }));
jest.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: {},
}));
jest.mock('@gitroom/nestjs-libraries/chat/tools/tool.list', () => ({
  toolList: [],
}));

const modelFactory = jest.fn((id: string) => ({ modelId: id }));
const createOpenAI = jest.fn((_: unknown) => modelFactory);
jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: (options: unknown) => createOpenAI(options),
}));

import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';

const MISSING = 'Add your OpenAI key in Settings → AI';

describe('LoadToolsService agent model', () => {
  let aiCredentialService: { getOpenAiKey: jest.Mock };
  let service: LoadToolsService;

  const buildModel = async () => {
    await service.agent();
    return agentConfigs[agentConfigs.length - 1].model as (args: {
      requestContext: { get: (key: string) => unknown };
    }) => Promise<unknown>;
  };

  const contextWith = (values: Record<string, unknown>) => ({
    get: (key: string) => values[key],
  });

  beforeEach(() => {
    agentConfigs.length = 0;
    createOpenAI.mockClear();
    modelFactory.mockClear();
    aiCredentialService = {
      getOpenAiKey: jest.fn(async (orgId: string) => `sk-key-for-${orgId}`),
    };
    service = new LoadToolsService({} as any, aiCredentialService as any);
  });

  it('is named postdelegate, so MCP clients see ask_postdelegate', async () => {
    await service.agent();

    expect(agentConfigs[agentConfigs.length - 1]).toMatchObject({
      id: 'postdelegate',
      name: 'postdelegate',
    });
  });

  it('is a function, so no key is read when the agent is built', async () => {
    const model = await buildModel();

    expect(typeof model).toBe('function');
    expect(aiCredentialService.getOpenAiKey).not.toHaveBeenCalled();
  });

  it('agent model uses the org key from requestContext', async () => {
    const model = await buildModel();

    const result = await model({
      requestContext: contextWith({
        organization: JSON.stringify({ id: 'org-1' }),
      }),
    });

    expect(aiCredentialService.getOpenAiKey).toHaveBeenCalledWith('org-1');
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-key-for-org-1' });
    expect(modelFactory).toHaveBeenCalledWith('gpt-5.2');
    expect(result).toEqual({ modelId: 'gpt-5.2' });
  });

  it('agent model falls back to getAuth()', async () => {
    const model = await buildModel();

    await runWithContext(
      { requestId: 'r-1', auth: { id: 'org-mcp' } },
      async () => {
        await model({ requestContext: contextWith({}) });
      }
    );

    expect(aiCredentialService.getOpenAiKey).toHaveBeenCalledWith('org-mcp');
    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: 'sk-key-for-org-mcp',
    });
  });

  it('agent model throws the missing-key error with no org', async () => {
    const model = await buildModel();

    await expect(
      model({ requestContext: contextWith({}) })
    ).rejects.toThrow(MISSING);
    expect(aiCredentialService.getOpenAiKey).not.toHaveBeenCalled();
    expect(createOpenAI).not.toHaveBeenCalled();
  });
});
