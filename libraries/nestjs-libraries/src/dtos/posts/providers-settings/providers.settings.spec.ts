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
