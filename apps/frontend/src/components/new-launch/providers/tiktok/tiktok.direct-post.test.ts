import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTikTokCreatorInfo,
  getTikTokDirectPostState,
  getTikTokPublishBlockedReason,
  isTikTokVideoPath,
  TIKTOK_BRANDED_CONTENT_NOT_PRIVATE,
  TIKTOK_COMMERCIAL_SELECTION_REQUIRED,
} from './tiktok.direct-post.ts';

const creator = {
  creatorUsername: 'review_creator',
  creatorNickname: 'Review creator',
  privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
  commentDisabled: false,
  duetDisabled: false,
  stitchDisabled: true,
  maxDurationSeconds: 60,
};
const video = {
  creatorInfo: creator,
  mediaKind: 'video' as const,
  videoDurationSeconds: 12,
  privacyLevel: '',
  disclose: false,
  ownBrand: false,
  brandedContent: false,
};

test('creator API error responses cannot unlock direct posting', () => {
  assert.equal(parseTikTokCreatorInfo({ statusCode: 429, message: 'Try later' }), undefined);
  assert.equal(getTikTokDirectPostState({ ...video, creatorInfo: undefined }).creatorReady, false);
});

test('incomplete creator data and empty posting options cannot unlock direct posting', () => {
  assert.equal(parseTikTokCreatorInfo({ ...creator, commentDisabled: undefined }), undefined);
  assert.equal(parseTikTokCreatorInfo({ ...creator, privacyLevelOptions: [] }), undefined);
  assert.equal(parseTikTokCreatorInfo({ ...creator, maxDurationSeconds: 0 }), undefined);
});

test('privacy options use the creator response without selecting a default', () => {
  const state = getTikTokDirectPostState(video);
  assert.deepEqual(state.privacyOptions, [
    { value: 'PUBLIC_TO_EVERYONE', disabled: false },
    { value: 'SELF_ONLY', disabled: false },
  ]);
  assert.equal(state.selectedPrivacyAllowed, false);
});

test('creator restrictions lock interactions and photos never offer Duet or Stitch', () => {
  const state = getTikTokDirectPostState({ ...video, creatorInfo: { ...creator, commentDisabled: true } });
  assert.equal(state.allowComment, false);
  assert.equal(state.allowDuet, true);
  assert.equal(state.allowStitch, false);
  const photo = getTikTokDirectPostState({ ...video, mediaKind: 'photo' });
  assert.equal(photo.allowDuet, false);
  assert.equal(photo.allowStitch, false);
});

test('video duration must be known and within the current creator limit', () => {
  assert.equal(getTikTokDirectPostState(video).creatorReady, true);
  assert.equal(getTikTokDirectPostState({ ...video, videoDurationSeconds: 60 }).creatorReady, true);
  assert.equal(getTikTokDirectPostState({ ...video, videoDurationSeconds: 60.01 }).creatorReady, false);
  assert.equal(getTikTokDirectPostState({ ...video, videoDurationSeconds: undefined }).creatorReady, false);
  assert.equal(getTikTokDirectPostState({ ...video, videoDurationSeconds: NaN }).creatorReady, false);
  assert.equal(getTikTokDirectPostState({ ...video, mediaKind: 'none' }).creatorReady, false);
});

test('commercial disclosure requires a brand choice and gives paid partnership precedence', () => {
  assert.equal(getTikTokDirectPostState({ ...video, disclose: true }).commercialValid, false);
  assert.equal(getTikTokDirectPostState({ ...video, disclose: true, ownBrand: true }).disclosureLabel, 'Promotional content');
  assert.equal(getTikTokDirectPostState({ ...video, disclose: true, brandedContent: true }).disclosureLabel, 'Paid partnership');
  assert.equal(getTikTokDirectPostState({ ...video, disclose: true, ownBrand: true, brandedContent: true }).disclosureLabel, 'Paid partnership');
});

test('branded content cannot select private visibility', () => {
  const state = getTikTokDirectPostState({ ...video, disclose: true, brandedContent: true, privacyLevel: 'SELF_ONLY' });
  assert.deepEqual(state.privacyOptions, [
    { value: 'PUBLIC_TO_EVERYONE', disabled: false },
    { value: 'SELF_ONLY', disabled: true },
  ]);
  assert.equal(state.selectedPrivacyAllowed, false);
  assert.equal(state.commercialValid, false);
});

test('video media detection supports documented formats with signed URLs', () => {
  assert.equal(isTikTokVideoPath('https://media.example/video.MOV?token=x'), true);
  assert.equal(isTikTokVideoPath('https://media.example/clip.webm#preview'), true);
  assert.equal(isTikTokVideoPath('https://media.example/mp4-banner.jpg'), false);
  assert.equal(isTikTokVideoPath('https://media.example/clip.m4v'), false);
});

const ready = { ...video, privacyLevel: 'PUBLIC_TO_EVERYONE' };
const blockedReason = (
  input: Partial<typeof ready>,
  extra: { creatorFailed?: boolean; videoMetadataFailed?: boolean; musicUsageConsent?: boolean } = {}
) => {
  const state = { ...ready, ...input };
  return getTikTokPublishBlockedReason({
    state: getTikTokDirectPostState(state),
    creatorInfo: state.creatorInfo,
    creatorFailed: extra.creatorFailed ?? false,
    mediaKind: state.mediaKind,
    videoDurationSeconds: state.videoDurationSeconds,
    videoMetadataFailed: extra.videoMetadataFailed,
    musicUsageConsent: extra.musicUsageConsent ?? true,
  });
};

test('a ready direct post has no blocking reason', () => {
  assert.equal(blockedReason({}), undefined);
  assert.equal(blockedReason({ disclose: true, ownBrand: true }), undefined);
  assert.equal(blockedReason({ disclose: true, brandedContent: true }), undefined);
});

test('disclosure without a brand choice blocks with the TikTok wording', () => {
  assert.equal(TIKTOK_COMMERCIAL_SELECTION_REQUIRED, 'You need to indicate if your content promotes yourself, a third party, or both.');
  assert.equal(blockedReason({ disclose: true }), TIKTOK_COMMERCIAL_SELECTION_REQUIRED);
  // the disclosure choice is asked first, even while other settings are missing
  assert.equal(blockedReason({ disclose: true, privacyLevel: '' }, { musicUsageConsent: false }), TIKTOK_COMMERCIAL_SELECTION_REQUIRED);
});

test('private branded content blocks with the TikTok wording', () => {
  assert.equal(
    blockedReason({ disclose: true, brandedContent: true, privacyLevel: 'SELF_ONLY' }),
    TIKTOK_BRANDED_CONTENT_NOT_PRIVATE
  );
});

test('a video longer than the creator max_video_post_duration_sec is blocked before posting', () => {
  const reason = blockedReason({ videoDurationSeconds: 61 });
  assert.match(reason!, /too long/);
  assert.match(reason!, /60 seconds/);
  assert.match(blockedReason({ videoDurationSeconds: undefined })!, /Checking video duration/);
  assert.match(blockedReason({ videoDurationSeconds: undefined }, { videoMetadataFailed: true })!, /could not be read/);
  // some files report no usable duration, which is unreadable rather than too long
  assert.match(blockedReason({ videoDurationSeconds: Infinity })!, /could not be read/);
  assert.match(blockedReason({ videoDurationSeconds: NaN })!, /could not be read/);
});

test('a creator that cannot post right now stops publishing with a try again later message', () => {
  assert.match(blockedReason({ creatorInfo: undefined }, { creatorFailed: true })!, /Try again later/);
  assert.match(blockedReason({ creatorInfo: undefined })!, /Checking the latest TikTok account settings/);
});

test('privacy and consent remain required', () => {
  assert.match(blockedReason({ privacyLevel: '' })!, /who can see/i);
  assert.match(blockedReason({}, { musicUsageConsent: false })!, /upload and publish/);
});
