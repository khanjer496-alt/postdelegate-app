import { Injectable } from '@nestjs/common';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { AutopostDto } from '@gitroom/nestjs-libraries/dtos/autopost/autopost.dto';
import dayjs from 'dayjs';
import { END, START, StateGraph } from '@langchain/langgraph';
import { AutoPost, Integration } from '@prisma/client';
import { BaseMessage } from '@langchain/core/messages';
import striptags from 'striptags';
import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai';
import { JSDOM } from 'jsdom';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import Parser from 'rss-parser';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { AiCredentialService } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import {
  readResponseText,
  ssrfSafeFetch,
} from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
const parser = new Parser();

// feeds and article pages are text, anything bigger is not worth reading
const MAX_REMOTE_TEXT_BYTES = 5_000_000;

interface WorkflowChannelsState {
  messages: BaseMessage[];
  integrations: Integration[];
  body: AutoPost;
  description: string;
  image: string;
  id: string;
  load: {
    date: string;
    url: string;
    description: string;
  };
}

// built per run from the workspace's own key, only when the run uses AI
type AutopostModels = {
  model: ChatOpenAI;
  dalle: DallEAPIWrapper;
};

const generateContent = z.object({
  socialMediaPostContent: z
    .string()
    .describe('Content for social media posts max 120 chars'),
});

const dallePrompt = z.object({
  generatedTextToBeSentToDallE: z
    .string()
    .describe('Generated prompt from description to be sent to DallE'),
});

@Injectable()
export class AutopostService {
  constructor(
    private _autopostsRepository: AutopostRepository,
    private _temporalService: TemporalService,
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _aiCredentialService: AiCredentialService
  ) {}

  async stopAll(org: string) {
    const getAll = (await this.getAutoposts(org)).filter((f) => f.active);
    for (const autopost of getAll) {
      await this.changeActive(org, autopost.id, false);
    }
  }

  getAutoposts(orgId: string) {
    return this._autopostsRepository.getAutoposts(orgId);
  }

  async createAutopost(orgId: string, body: AutopostDto, id?: string) {
    const data = await this._autopostsRepository.createAutopost(
      orgId,
      body,
      id
    );

    await this.processCron(body.active, orgId, data.id);

    return data;
  }

  async changeActive(orgId: string, id: string, active: boolean) {
    const data = await this._autopostsRepository.changeActive(
      orgId,
      id,
      active
    );
    await this.processCron(active, orgId, id);
    return data;
  }

  async processCron(active: boolean, orgId: string, id: string) {
    if (active) {
      try {
        return await this._temporalService.client
          .getRawClient()
          ?.workflow.start('autoPostWorkflow', {
            workflowId: `autopost-${id}`,
            taskQueue: 'main',
            args: [{ id, immediately: true }],
            // Keep a running workflow, it reads the autopost settings on every run
            workflowIdConflictPolicy: 'USE_EXISTING',
            typedSearchAttributes: new TypedSearchAttributes([
              {
                key: organizationId,
                value: orgId,
              },
            ]),
          });
      } catch (err) {
        // Don't fall through and terminate an active autopost
        return false;
      }
    }

    try {
      return await this._temporalService.terminateWorkflow(`autopost-${id}`);
    } catch (err) {
      return false;
    }
  }

  async deleteAutopost(orgId: string, id: string) {
    const data = await this._autopostsRepository.deleteAutopost(orgId, id);
    await this.processCron(false, orgId, id);
    return data;
  }

  async loadXML(url: string) {
    try {
      // the feed is read through the SSRF-safe client (redirects re-validated
      // on every hop) instead of rss-parser's own http client
      const response = await ssrfSafeFetch(url);
      if (!response.ok) {
        return { success: false };
      }
      const { items } = await parser.parseString(
        await readResponseText(response, MAX_REMOTE_TEXT_BYTES)
      );
      const findLast = items.reduce(
        (all: any, current: any) => {
          if (dayjs(current.pubDate).isAfter(all.pubDate)) {
            return current;
          }
          return all;
        },
        { pubDate: dayjs().subtract(100, 'years') }
      );

      return {
        success: true,
        date: findLast.pubDate,
        url: findLast.link,
        description: striptags(
          findLast?.['content:encoded'] ||
            findLast?.content ||
            findLast?.description ||
            ''
        )
          .replace(/\n/g, ' ')
          .trim(),
      };
    } catch (err) {
      /** sent **/
    }

    return { success: false };
  }

  static state = () =>
    new StateGraph<WorkflowChannelsState>({
      channels: {
        messages: {
          reducer: (currentState, updateValue) =>
            currentState.concat(updateValue),
          default: () => [],
        },
        body: null,
        description: null,
        load: null,
        image: null,
        integrations: null,
        id: null,
      },
    });

  async loadUrl(url: string) {
    try {
      // the url comes from the feed item, so it is attacker-controlled
      const response = await ssrfSafeFetch(url, {}, { allowHttp: true });
      const loadDom = new JSDOM(
        await readResponseText(response, MAX_REMOTE_TEXT_BYTES)
      );
      loadDom.window.document
        .querySelectorAll('script')
        .forEach((s) => s.remove());
      loadDom.window.document
        .querySelectorAll('style')
        .forEach((s) => s.remove());
      // remove all html, script and styles
      return striptags(loadDom.window.document.body.innerHTML);
    } catch (err) {
      return '';
    }
  }

  async generateDescription(
    state: WorkflowChannelsState,
    models: AutopostModels
  ) {
    if (!state.body.generateContent) {
      return {
        ...state,
        description: state.body.content,
      };
    }

    const description =
      state.load.description || (await this.loadUrl(state.load.url));
    if (!description) {
      return {
        ...state,
        description: '',
      };
    }

    const structuredOutput = models.model.withStructuredOutput(generateContent);
    const { socialMediaPostContent } = await ChatPromptTemplate.fromTemplate(
      `
        You are an assistant that gets raw 'description' of a content and generate a social media post content.
        Rules:
        - Maximum 100 chars
        - Try to make it a short as possible to fit any social media
        - Add line breaks between sentences (\\n) 
        - Don't add hashtags
        - Add emojis when needed
        
        'description':
        {content}
      `
    )
      .pipe(structuredOutput)
      .invoke({
        content: description,
      });

    return {
      ...state,
      description: socialMediaPostContent,
    };
  }

  async generatePicture(state: WorkflowChannelsState, models: AutopostModels) {
    const structuredOutput = models.model.withStructuredOutput(dallePrompt);
    const { generatedTextToBeSentToDallE } =
      await ChatPromptTemplate.fromTemplate(
        `
        You are an assistant that gets description and generate a prompt that will be sent to DallE to generate pictures.
        
        content:
        {content}
      `
      )
        .pipe(structuredOutput)
        .invoke({
          content: state.load.description || state.description,
        });

    const image = await models.dalle.invoke(generatedTextToBeSentToDallE);

    return { ...state, image };
  }

  async schedulePost(state: WorkflowChannelsState) {
    const nextTime = await this._postsService.findFreeDateTime(
      state.integrations[0].organizationId
    );

    await this._postsService.createPost(state.integrations[0].organizationId, {
      date: nextTime + 'Z',
      order: makeId(10),
      shortLink: false,
      type: 'draft',
      tags: [],
      posts: state.integrations.map((i) => ({
        settings: {
          __type: i.providerIdentifier as any,
          title: '',
          tags: [],
          subreddit: [],
        },
        group: makeId(10),
        integration: { id: i.id },
        value: [
          {
            id: makeId(10),
            delay: 0,
            content:
              state.description.replace(/\n/g, '\n\n') +
              '\n\n' +
              state.load.url,
            image: !state.image
              ? []
              : [
                  {
                    id: makeId(10),
                    name: makeId(10),
                    path: state.image,
                    organizationId: state.integrations[0].organizationId,
                  },
                ],
          },
        ],
      })),
    }, 'AUTOPOST');
  }

  async updateUrl(state: WorkflowChannelsState) {
    await this._autopostsRepository.updateUrl(state.id, state.load.url);
  }

  private async buildModels(orgId: string): Promise<AutopostModels> {
    const apiKey = await this._aiCredentialService.getOpenAiKey(orgId);
    return {
      model: new ChatOpenAI({
        apiKey,
        model: 'gpt-4.1',
        temperature: 0.7,
      }),
      dalle: new DallEAPIWrapper({
        apiKey,
        model: 'chatgpt-image-latest',
      }),
    };
  }

  async startAutopost(id: string) {
    const getPost = await this._autopostsRepository.getAutopost(id);
    if (!getPost || !getPost.active) {
      return;
    }

    const load = await this.loadXML(getPost.url);
    if (!load.success || load.url === getPost.lastUrl) {
      return;
    }

    const integrations = await this._integrationService.getIntegrationsList(
      getPost.organizationId
    );

    const parseIntegrations = JSON.parse(getPost.integrations || '[]') || [];
    const neededIntegrations = integrations.filter((i) =>
      parseIntegrations.some((ii: any) => ii.id === i.id)
    );

    const integrationsToSend =
      parseIntegrations.length === 0 ? integrations : neededIntegrations;
    if (integrationsToSend.length === 0) {
      return;
    }

    const needsAi = getPost.generateContent || getPost.addPicture;
    if (
      needsAi &&
      !(await this._aiCredentialService.hasCredential(getPost.organizationId))
    ) {
      // ends like a run with nothing new: the last url is not stored, so the
      // feed is picked up again once the workspace has a key
      console.log(
        `Autopost ${id} skipped: AI is on and the workspace has no OpenAI key`
      );
      return;
    }

    // built once per run, and only when the run uses AI. Without AI the post
    // keeps the autopost's own content and the picture step is never reached
    const models = needsAi
      ? await this.buildModels(getPost.organizationId)
      : undefined;

    const state = AutopostService.state();
    const workflow = state
      .addNode('generate-description', (state) =>
        models
          ? this.generateDescription(state, models)
          : { ...state, description: state.body.content }
      )
      .addNode('generate-picture', (state) =>
        models ? this.generatePicture(state, models) : state
      )
      .addNode('schedule-post', this.schedulePost.bind(this))
      .addNode('update-url', this.updateUrl.bind(this))
      .addEdge(START, 'generate-description')
      .addConditionalEdges(
        'generate-description',
        (state: WorkflowChannelsState) => {
          if (!state.description) {
            return 'schedule-post';
          }
          if (state.body.addPicture) {
            return 'generate-picture';
          }
          return 'schedule-post';
        }
      )
      .addEdge('generate-picture', 'schedule-post')
      .addEdge('schedule-post', 'update-url')
      .addEdge('update-url', END);

    const app = workflow.compile();
    await app.invoke({
      messages: [],
      id,
      body: getPost,
      load,
      integrations: integrationsToSend,
    });
  }
}
