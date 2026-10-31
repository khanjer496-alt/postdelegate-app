export type TikTokCreatorInfo = {
  creatorUsername: string;
  creatorNickname: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSeconds: number;
};

const privacyLevels = new Set([
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
]);

// Custom-provider failures can be returned as JSON too. Never treat an error or
// a partial response as permission to publish with guessed creator settings.
export function parseTikTokCreatorInfo(value: unknown): TikTokCreatorInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const info = value as TikTokCreatorInfo;
  if (
    typeof info.creatorNickname !== 'string' || !info.creatorNickname.trim() ||
    typeof info.creatorUsername !== 'string' ||
    !Array.isArray(info.privacyLevelOptions) || !info.privacyLevelOptions.length ||
    !info.privacyLevelOptions.every((level) => privacyLevels.has(level)) ||
    typeof info.commentDisabled !== 'boolean' ||
    typeof info.duetDisabled !== 'boolean' ||
    typeof info.stitchDisabled !== 'boolean' ||
    !Number.isFinite(info.maxDurationSeconds) || info.maxDurationSeconds <= 0
  ) return undefined;
  return info;
}

// TikTok's Content Sharing Guidelines wording, shown on the disabled actions.
export const TIKTOK_COMMERCIAL_SELECTION_REQUIRED =
  'You need to indicate if your content promotes yourself, a third party, or both.';
export const TIKTOK_BRANDED_CONTENT_NOT_PRIVATE =
  'Branded content visibility cannot be set to private.';

// The DTO reports a missing brand choice on `disclose`, so a change to any of
// these fields re-validates all of them.
const commercialFields = ['disclose', 'brand_organic_toggle', 'brand_content_toggle'];
export function getTikTokFieldsToValidate(name: string): string[] {
  return commercialFields.includes(name) ? commercialFields : [name];
}

// The composer shows the missing brand choice live under the brand options, so
// the same field error is not repeated under a checkbox.
export function getTikTokCheckboxError(error: unknown): string | undefined {
  return typeof error === 'string' && error !== TIKTOK_COMMERCIAL_SELECTION_REQUIRED
    ? error
    : undefined;
}

// Why the video duration does not allow posting yet, or undefined when it does.
export function getTikTokVideoDurationMessage(input: {
  maxDurationSeconds: number;
  videoDurationSeconds?: number;
  videoMetadataFailed?: boolean;
}): string | undefined {
  const duration = input.videoDurationSeconds;
  if (input.videoMetadataFailed || (duration !== undefined && (!Number.isFinite(duration) || duration <= 0))) {
    return 'The video duration could not be read. Re-upload a playable MP4, MOV or WebM before posting.';
  }
  if (duration === undefined) {
    return 'Checking video duration before publishing…';
  }
  if (duration > input.maxDurationSeconds) {
    return `This video is too long for this TikTok account. Choose a video no longer than ${input.maxDurationSeconds} seconds.`;
  }
  return undefined;
}

export function isTikTokVideoPath(path: string): boolean {
  return /\.(mp4|mov|webm)(?:$|[?#])/i.test(path);
}

export function getTikTokDirectPostState(input: {
  creatorInfo?: TikTokCreatorInfo;
  mediaKind: 'video' | 'photo' | 'none';
  videoDurationSeconds?: number;
  privacyLevel: string;
  disclose: boolean;
  ownBrand: boolean;
  brandedContent: boolean;
}) {
  const info = input.creatorInfo;
  const branded = input.disclose && input.brandedContent;
  const privacyOptions = (info?.privacyLevelOptions || []).map((value) => ({
    value,
    disabled: branded && value === 'SELF_ONLY',
  }));
  const validDuration = input.mediaKind !== 'video' || (
    Number.isFinite(input.videoDurationSeconds) &&
    input.videoDurationSeconds! > 0 &&
    input.videoDurationSeconds! <= (info?.maxDurationSeconds || 0)
  );
  return {
    creatorReady: !!info && input.mediaKind !== 'none' && validDuration,
    validDuration,
    privacyOptions,
    selectedPrivacyAllowed: privacyOptions.some(
      (option) => option.value === input.privacyLevel && !option.disabled
    ),
    allowComment: !!info && !info.commentDisabled,
    allowDuet: !!info && input.mediaKind === 'video' && !info.duetDisabled,
    allowStitch: !!info && input.mediaKind === 'video' && !info.stitchDisabled,
    commercialSelectionMissing:
      input.disclose && !input.ownBrand && !input.brandedContent,
    commercialValid: !input.disclose || (
      (input.ownBrand || input.brandedContent) &&
      !(branded && input.privacyLevel === 'SELF_ONLY')
    ),
    disclosureLabel: !input.disclose ? undefined : branded
      ? 'Paid partnership'
      : input.ownBrand ? 'Promotional content' : undefined,
  };
}

// Why a legacy Direct Post cannot be published yet, or undefined when it can.
// The composer shows it on the disabled Post now / Add to calendar actions.
export function getTikTokPublishBlockedReason(input: {
  state: ReturnType<typeof getTikTokDirectPostState>;
  creatorInfo?: TikTokCreatorInfo;
  creatorFailed: boolean;
  mediaKind: 'video' | 'photo' | 'none';
  videoDurationSeconds?: number;
  videoMetadataFailed?: boolean;
  musicUsageConsent: boolean;
}): string | undefined {
  const { state, creatorInfo } = input;
  if (state.commercialSelectionMissing) {
    return TIKTOK_COMMERCIAL_SELECTION_REQUIRED;
  }
  if (!state.creatorReady) {
    if (input.creatorFailed) {
      return 'TikTok cannot confirm that this account can post right now. Try again later.';
    }
    if (!creatorInfo) {
      return 'Checking the latest TikTok account settings…';
    }
    if (input.mediaKind === 'none') {
      return 'Add a photo or video to post to TikTok.';
    }
    return getTikTokVideoDurationMessage({
      maxDurationSeconds: creatorInfo.maxDurationSeconds,
      videoDurationSeconds: input.videoDurationSeconds,
      videoMetadataFailed: input.videoMetadataFailed,
    });
  }
  if (!state.commercialValid) {
    return TIKTOK_BRANDED_CONTENT_NOT_PRIVATE;
  }
  if (!state.selectedPrivacyAllowed) {
    return 'Choose who can see this TikTok post.';
  }
  if (!input.musicUsageConsent) {
    return 'Confirm that PostDelegate can upload and publish this content to TikTok.';
  }
  return undefined;
}
