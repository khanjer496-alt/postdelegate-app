import 'reflect-metadata';
// the sanitizer pulls in a DOM, the settings are what is under test
jest.mock('@gitroom/helpers/utils/sanitize.post.content', () => ({
  sanitizePostContent: (html: string) => html,
}));
import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validate, ValidationError } from 'class-validator';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import {
  allProviders,
  EmptySettings,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import { TumblrDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tumblr.dto';
import { DiscordDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/discord.dto';
import { SlackDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/slack.dto';
import { WordpressDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/wordpress.dto';
import { ListmonkDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/listmonk.dto';
import {
  LemmySettingsDto,
  LemmySettingsDtoInner,
  LemmySettingsValueDto,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/lemmy.dto';
import { WhopDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/whop.dto';
import {
  YoutubeSettingsDto,
  YoutubeTagsSettings,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import {
  HashnodeSettingsDto,
  HashnodeTagsSettings,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/hashnode.settings.dto';
import { MediumSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/medium.settings.dto';

const messages = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...Object.values(error.constraints || {}),
    ...messages(error.children || []),
  ]);

// the body the composer sends for one post, with or without an image
const kickPost = (settings: Record<string, unknown>, image: unknown[] = []) =>
  plainToInstance(CreatePostDto, {
    type: 'schedule',
    shortLink: false,
    date: '2026-11-05T10:00:00',
    tags: [],
    posts: [
      {
        integration: { id: 'kick-1' },
        value: [{ content: 'Live in 10 minutes', image }],
        settings,
      },
    ],
  });

describe('Kick post settings', () => {
  it('validates a Kick post without settings of its own', async () => {
    expect(messages(await validate(kickPost({ __type: 'kick' })))).toEqual([]);
  });

  it('validates a Kick post with an image', async () => {
    expect(
      messages(
        await validate(
          kickPost({ __type: 'kick' }, [
            { id: 'media-1', path: 'https://uploads.postdelegate.com/a.png' },
          ])
        )
      )
    ).toEqual([]);
  });

  it('validates the post the same way the API pipe does', async () => {
    expect(
      messages(
        await validate(kickPost({ __type: 'kick' }), {
          forbidUnknownValues: true,
        })
      )
    ).toEqual([]);
  });

  // class-validator refuses an object of a class without a single rule
  it('gives every network a settings class with validation rules', () => {
    for (const { name, value } of allProviders(EmptySettings)) {
      expect([
        name,
        getMetadataStorage().getTargetValidationMetadatas(
          value,
          '',
          true,
          false
        ).length,
      ]).not.toEqual([name, 0]);
    }
  });
});

describe('Tumblr post settings', () => {
  // the composer sends the title box as it is, empty when it was left alone
  it('posts without a title', async () => {
    expect(
      messages(
        await validate(
          plainToInstance(TumblrDto, { title: '', link: '', tags: '' })
        )
      )
    ).toEqual([]);
  });

  it('still refuses a title over 4096 characters', async () => {
    expect(
      messages(
        await validate(plainToInstance(TumblrDto, { title: 'x'.repeat(4097) }))
      )
    ).toHaveLength(1);
  });
});

// the composer shows the first message as it is (posts.service
// firstValidationError), so none may be class-validator's own wording
describe('Channel settings messages', () => {
  const dtos = [
    DiscordDto,
    SlackDto,
    WordpressDto,
    ListmonkDto,
    LemmySettingsDto,
    LemmySettingsValueDto,
    LemmySettingsDtoInner,
    WhopDto,
    YoutubeSettingsDto,
    YoutubeTagsSettings,
    HashnodeSettingsDto,
    HashnodeTagsSettings,
  ];

  it.each(dtos.map((dto) => [dto.name, dto]))(
    'gives every rule of %s a message in plain words',
    (_, dto) => {
      const rules = getMetadataStorage()
        .getTargetValidationMetadatas(dto as any, '', true, false)
        // IsOptional / ValidateIf only skip rules; the YouTube publish time
        // and tags length rules word their own message
        .filter(
          (rule) =>
            rule.type !== 'conditionalValidation' &&
            rule.name !== 'youtubePublishAt' &&
            (rule.constraintCls as any)?.name !== 'IsYoutubeTagsLengthConstraint'
        );
      expect(rules.length).toBeGreaterThan(0);
      expect(
        rules
          .filter((rule) => !rule.message)
          .map((rule) => `${rule.propertyName}: ${rule.name || rule.type}`)
      ).toEqual([]);
    }
  );

  const firstMessage = async (dto: any, value: Record<string, unknown>) =>
    messages(await validate(plainToInstance(dto, value)))[0];

  it('words an empty Discord or Slack channel', async () => {
    expect(await firstMessage(DiscordDto, {})).toBe('Choose a Discord channel');
    expect(await firstMessage(SlackDto, { channel: '' })).toBe(
      'Choose a Slack channel'
    );
  });

  it('calls Lemmy places communities', async () => {
    const all = messages(
      await validate(
        plainToInstance(LemmySettingsDto, {
          subreddit: [{ value: { subreddit: '', id: '', title: '' } }],
        })
      )
    );
    expect(all).toContain('Choose a Lemmy community');
    expect(all.join(' ')).not.toMatch(/subreddit/i);
    expect(await firstMessage(LemmySettingsDto, { subreddit: [] })).toBe(
      'Add at least one Lemmy community'
    );
  });
});

describe('Required pickers', () => {
  const wordpress = { title: 'Hello world', type: '' };
  const listmonk = { subject: 'News', preview: '', list: '' };

  // the pickers start on "--Select--", an empty value
  it('refuses a WordPress post type left on --Select--', async () => {
    expect(messages(await validate(plainToInstance(WordpressDto, wordpress)))).toEqual([
      'Choose a post type',
    ]);
    expect(
      messages(
        await validate(plainToInstance(WordpressDto, { ...wordpress, type: 'post' }))
      )
    ).toEqual([]);
  });

  it('refuses a Listmonk list left on --Select--', async () => {
    expect(messages(await validate(plainToInstance(ListmonkDto, listmonk)))).toEqual([
      'Choose a list to send the email to',
    ]);
    expect(
      messages(
        await validate(plainToInstance(ListmonkDto, { ...listmonk, list: '3' }))
      )
    ).toEqual([]);
  });
});

describe('Hashnode subtitle', () => {
  const settings = {
    title: 'A long enough title',
    publication: 'pub-1',
    tags: [{ value: 't', label: 'T' }],
  };

  // the composer sends the empty box as ''
  it('is optional when left empty', async () => {
    expect(
      messages(
        await validate(plainToInstance(HashnodeSettingsDto, { ...settings, subtitle: '' }))
      )
    ).toEqual([]);
    expect(
      messages(await validate(plainToInstance(HashnodeSettingsDto, settings)))
    ).toEqual([]);
  });

  it('still needs 2 characters once filled', async () => {
    expect(
      messages(
        await validate(plainToInstance(HashnodeSettingsDto, { ...settings, subtitle: 'a' }))
      )
    ).toEqual(['The subtitle must be at least 2 characters']);
  });
});

describe('Medium settings', () => {
  // Medium's API has no subtitle, the field was required and never sent
  it('no longer asks for a subtitle', async () => {
    expect(
      messages(await validate(plainToInstance(MediumSettingsDto, { title: 'Hi there' })))
    ).toEqual([]);
  });
});
