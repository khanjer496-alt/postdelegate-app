import {
  IsArray,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidateBy,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import { Type } from 'class-transformer';
import { JSONSchema } from 'class-validator-jsonschema';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';

dayjs.extend(utc);

// YouTube caps the combined length of all tags at 500 characters.
// Tags containing whitespace are wrapped in quotes by YouTube, which adds
// two extra characters per tag toward that limit.
export const YOUTUBE_TAGS_MAX_LENGTH = 500;

export function getYoutubeTagsLength(tags: YoutubeTagsSettings[]): number {
  return (tags ?? []).reduce((total, tag) => {
    const label = tag?.label ?? '';
    return total + label.length + (/\s/.test(label) ? 2 : 0);
  }, 0);
}

@ValidatorConstraint({ name: 'IsYoutubeTagsLength', async: false })
export class IsYoutubeTagsLengthConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, _args: ValidationArguments): boolean {
    if (!Array.isArray(value)) {
      return true;
    }
    return getYoutubeTagsLength(value) <= YOUTUBE_TAGS_MAX_LENGTH;
  }

  defaultMessage(_args: ValidationArguments): string {
    return `The maximum allowed is ${YOUTUBE_TAGS_MAX_LENGTH} characters in total for all tags.`;
  }
}

export function IsYoutubeTagsLength(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsYoutubeTagsLengthConstraint,
    });
  };
}

// RFC 3339, the format YouTube documents for publishAt:
// YYYY-MM-DDTHH:mm[:ss][.sss] with Z or an ±HH:mm offset
export const YOUTUBE_PUBLISH_AT_FORMAT =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
const YOUTUBE_PUBLISH_AT_MESSAGE =
  'Pick a valid date and time for YouTube to publish the video, like 2026-11-05T15:00:00Z.';

// The publish time when it is a real RFC 3339 date (2026-02-30 is not), the
// provider uses it too so an unreadable value never changes the visibility
export const parseYoutubePublishAt = (value?: string) => {
  const match = YOUTUBE_PUBLISH_AT_FORMAT.exec(value || '');
  if (!match) {
    return undefined;
  }
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  if (dayjs.utc(day).format('YYYY-MM-DD') !== day) {
    return undefined;
  }
  const date = dayjs.utc(value);
  return date.isValid() ? date : undefined;
};

// The server supplies this ephemeral context while it validates: the operation
// it will execute and the date the post itself goes out. The time rules only
// apply while the video is still to be uploaded (schedule / now, or an update
// of a post that has not gone out yet), editing a published video or saving a
// draft keeps ordinary validation.
type YoutubeValidationContext = {
  publishAt?: string;
  __validationOperation?: string;
  __validationDate?: string;
};

const getYoutubePublishAtError = (
  settings: YoutubeValidationContext
): string | undefined => {
  const operation = settings?.__validationOperation || '';
  // post dates are stored without a zone and are UTC
  const postDate = settings?.__validationDate
    ? dayjs.utc(settings.__validationDate)
    : undefined;
  const notUploadedYet =
    operation === 'update' &&
    !!postDate?.isValid() &&
    postDate.isAfter(dayjs.utc());

  // the format itself is reported by @Matches
  if (
    !settings?.publishAt ||
    !YOUTUBE_PUBLISH_AT_FORMAT.test(settings.publishAt)
  ) {
    return undefined;
  }

  const publishAt = parseYoutubePublishAt(settings.publishAt);
  if (!publishAt) {
    return YOUTUBE_PUBLISH_AT_MESSAGE;
  }

  if (!(['schedule', 'now'].includes(operation) || notUploadedYet)) {
    return undefined;
  }

  if (!publishAt.isAfter(dayjs.utc())) {
    return 'The time YouTube makes the video public must be in the future.';
  }

  // a post sent now is uploaded now, the check above already covers it
  if (
    operation !== 'now' &&
    postDate?.isValid() &&
    !publishAt.isAfter(postDate)
  ) {
    return 'The time YouTube makes the video public must be after the post is published, the video is uploaded at the post time.';
  }

  return undefined;
};

export class YoutubeTagsSettings {
  @IsString({ message: 'Each tag needs a value and a label' })
  value: string;

  @IsString({ message: 'Each tag needs a value and a label' })
  label: string;
}

export class YoutubeSettingsDto {
  @IsString({ message: 'Add a title of at least 2 characters' })
  @MinLength(2, { message: 'Add a title of at least 2 characters' })
  @MaxLength(100, { message: 'The title can be at most 100 characters' })
  @IsDefined({ message: 'Add a title of at least 2 characters' })
  title: string;

  @IsIn(['public', 'private', 'unlisted'], {
    message: 'Choose who can watch the video: public, private or unlisted',
  })
  @IsDefined({
    message: 'Choose who can watch the video: public, private or unlisted',
  })
  type: string;

  @IsIn(['yes', 'no'], {
    message: 'Choose whether the video is made for kids',
  })
  @IsOptional()
  selfDeclaredMadeForKids: 'no' | 'yes';

  @IsOptional()
  @Matches(YOUTUBE_PUBLISH_AT_FORMAT, { message: YOUTUBE_PUBLISH_AT_MESSAGE })
  @ValidateBy({
    name: 'youtubePublishAt',
    validator: {
      validate: (_value, args) =>
        !getYoutubePublishAtError(args?.object as YoutubeValidationContext),
      defaultMessage: (args) =>
        getYoutubePublishAtError(args?.object as YoutubeValidationContext) ||
        '',
    },
  })
  @JSONSchema({
    format: 'date-time',
    description:
      'Publish later on YouTube: an ISO 8601 date and time (e.g. 2026-11-05T15:00:00Z) after the post date. The video is still uploaded at the post date, as private whatever the type is, and YouTube itself makes it public at this time. Leave it out to publish with the type at the post date.',
  })
  // one date per post, a bulk form would give every video the same one
  @ComposerOnly()
  publishAt?: string;

  @IsIn(['yes', 'no'], {
    message: 'Choose whether the video has altered or synthetic content',
  })
  @IsOptional()
  @JSONSchema({
    description:
      'Set to "yes" when the video contains realistic altered or synthetic content (for example AI that makes a real person appear to say or do something they did not, alters footage of a real event or place, or generates a realistic scene that did not happen). YouTube requires this disclosure for such content. Defaults to "no".',
  })
  containsSyntheticMedia?: 'no' | 'yes';

  @IsOptional()
  @ValidateNested({ message: 'Choose the thumbnail from the media library' })
  @Type(() => MediaDto)
  thumbnail?: MediaDto;

  @IsArray({ message: 'The tags must be a list' })
  @IsOptional()
  @ValidateNested({ each: true, message: 'Each tag needs a value and a label' })
  @IsYoutubeTagsLength()
  @Type(() => YoutubeTagsSettings)
  tags: YoutubeTagsSettings[];
}
