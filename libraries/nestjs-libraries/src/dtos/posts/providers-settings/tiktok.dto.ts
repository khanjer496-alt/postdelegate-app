import {
  IsBoolean,
  ValidateIf,
  IsIn,
  IsString,
  MaxLength,
  IsOptional,
  IsDefined,
  IsNumber,
  Min,
  Max,
  ValidateNested,
  Equals,
  ValidateBy,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JSONSchema } from 'class-validator-jsonschema';

export class TikTokMusic {
  @IsDefined()
  @IsString()
  @JSONSchema({
    description:
      'The commercial music library track id, taken from the "id" returned by the musicSearch function.',
  })
  id: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  artist?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  audio_volume?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  video_volume?: number;
}

export class TikTokLocation {
  @IsDefined()
  @IsString()
  @JSONSchema({
    description:
      'The location tag id, taken from the "id" returned by the locationSearch function.',
  })
  id: string;

  @IsDefined()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;
}

// The server supplies this ephemeral context from the operation it will
// execute. Editing saved settings requires ordinary validation, while fresh
// publishing acknowledgements apply only when scheduling or publishing.
const requiresDirectPostAcknowledgements = (
  settings: TikTokDto & { __type?: string; __validationOperation?: string }
) =>
  settings.__type === 'tiktok' &&
  settings.content_posting_method !== 'UPLOAD' &&
  settings.__validationOperation !== 'draft' &&
  settings.__validationOperation !== 'update';

// TikTok only honors most of these settings on a DIRECT_POST. With
// content_posting_method=UPLOAD the media lands in the user's TikTok inbox as a
// draft. The legacy video inbox endpoint accepts only media; the photo inbox
// endpoint also accepts title / description. Direct-post settings do not apply.
// This integration applies video_made_with_ai / duet / stitch to videos only;
// it does not send those fields for photo posts.
// music / location are TikTok Business only: the legacy TikTok provider ignores
// them (its Content Posting API has no music_sound_info / location fields).
// The legacy provider additionally checks fresh creator permissions at publish
// time. UI acknowledgement fields below apply only to legacy DIRECT_POST;
// TikTok Business uses a separate API and retains its existing settings.
export class TikTokDto {
  @ValidateIf((p) => p.title)
  @MaxLength(90)
  @JSONSchema({
    description:
      'Photo post title. Legacy photo UPLOAD keeps the title and description; legacy video UPLOAD accepts no caption metadata, so the user adds it inside TikTok.',
  })
  title: string;

  @ValidateIf(
    (p) => p.__type !== 'tiktok' || p.content_posting_method !== 'UPLOAD'
  )
  @ValidateBy({
    name: 'brandedContentPrivacy',
    validator: {
      validate: (value, args) => {
        const settings = args.object as TikTokDto & { __type?: string };
        return (
          !requiresDirectPostAcknowledgements(settings) ||
          !settings.brand_content_toggle ||
          value !== 'SELF_ONLY'
        );
      },
      defaultMessage: () => 'Branded content cannot use private visibility.',
    },
  })
  @IsIn([
    'PUBLIC_TO_EVERYONE',
    'MUTUAL_FOLLOW_FRIENDS',
    'FOLLOWER_OF_CREATOR',
    'SELF_ONLY',
  ])
  @IsString()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  privacy_level:
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY';

  @IsBoolean()
  @JSONSchema({
    description:
      'Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no duet setting for photo posts.',
  })
  duet: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no stitch setting for photo posts.',
  })
  stitch: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  comment: boolean;

  @IsIn(['yes', 'no'])
  @JSONSchema({
    description:
      'Photo posts only, and only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD. ' +
      'On TikTok Business, "yes" attaches a random commercial music library track and overrides the music setting; ' +
      'on legacy TikTok, "yes" lets TikTok auto-add its recommended music.',
  })
  autoAddMusic: 'yes' | 'no';

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  brand_content_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  @JSONSchema({
    description:
      'Labels the post as AI generated. This integration applies it to video posts only, and only when content_posting_method=DIRECT_POST. Not sent for photo posts or UPLOAD.',
  })
  video_made_with_ai: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  brand_organic_toggle: boolean;

  @ValidateIf(requiresDirectPostAcknowledgements)
  @IsBoolean()
  @ValidateBy({
    name: 'commercialContentSelection',
    validator: {
      validate: (value, args) => {
        const settings = args.object as TikTokDto;
        return (
          !value ||
          settings.brand_content_toggle === true ||
          settings.brand_organic_toggle === true
        );
      },
      defaultMessage: () =>
        'Select Your brand or Branded content when commercial disclosure is enabled.',
    },
  })
  @JSONSchema({
    description:
      'Legacy TikTok DIRECT_POST only. Commercial content disclosure is enabled; select at least one brand disclosure option.',
  })
  disclose?: boolean;

  @ValidateIf(requiresDirectPostAcknowledgements)
  @Equals(true, {
    message: 'Accept TikTok Music Usage Confirmation before posting.',
  })
  @JSONSchema({
    description:
      'Legacy TikTok DIRECT_POST only. Explicit user acceptance of TikTok Music Usage Confirmation; must be true.',
  })
  music_usage_consent?: boolean;

  @ValidateIf(requiresDirectPostAcknowledgements)
  @Equals(true, {
    message:
      'Load current TikTok account information and validate the media before posting.',
  })
  @JSONSchema({
    description:
      'Legacy TikTok DIRECT_POST only. Composer has loaded current creator information and validated the media. The server independently queries creator permissions again.',
  })
  creator_info_verified?: boolean;

  @Type(() => TikTokMusic)
  @ValidateNested()
  @IsOptional()
  @JSONSchema({
    description:
      'TikTok Business only, and only when content_posting_method=DIRECT_POST. Attaches a commercial music library track to the post (use the musicSearch function to find one). audio_volume / video_volume apply to video posts only. For photos, ignored when autoAddMusic is "yes" (a random track is attached instead).',
  })
  music?: TikTokMusic;

  @Type(() => TikTokLocation)
  @ValidateNested()
  @IsOptional()
  @JSONSchema({
    description:
      'TikTok Business only, and only when content_posting_method=DIRECT_POST. Tags the post with a location (use the locationSearch function to find one).',
  })
  location?: TikTokLocation;

  @IsIn(['DIRECT_POST', 'UPLOAD'])
  @IsString()
  @JSONSchema({
    description:
      'Required. Use "DIRECT_POST" to actually publish the post to TikTok. ' +
      '"UPLOAD" does NOT publish: it only sends the media to the user\'s TikTok app inbox, ' +
      'where they must manually finish and publish it within 24 hours or it is discarded, ' +
      'Legacy video UPLOAD sends only media; users add caption metadata inside TikTok. Photo UPLOAD also sends title and description. Direct-post settings do not apply. ' +
      'Only use "UPLOAD" when the user explicitly asks to review or edit the post inside the TikTok app before publishing.',
  })
  content_posting_method: 'DIRECT_POST' | 'UPLOAD';
}
