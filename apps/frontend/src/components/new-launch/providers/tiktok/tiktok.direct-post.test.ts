import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTikTokCreatorInfo,
  getTikTokDirectPostState,
  isTikTokVideoPath,
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
