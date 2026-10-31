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
    commercialValid: !input.disclose || (
      (input.ownBrand || input.brandedContent) &&
      !(branded && input.privacyLevel === 'SELF_ONLY')
    ),
    disclosureLabel: !input.disclose ? undefined : branded
      ? 'Paid partnership'
      : input.ownBrand ? 'Promotional content' : undefined,
  };
}
