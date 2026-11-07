'use client';

import { FC, ReactNode, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { TikTokDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Select } from '@gitroom/react/form/select';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { Input } from '@gitroom/react/form/input';
import { TiktokPreview } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.preview';
import { TikTokMusicSelector } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.music';
import { TikTokLocationSelector } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.location';
import {
  getTikTokCheckboxError,
  getTikTokDirectPostState,
  getTikTokFieldsToValidate,
  getTikTokPublishBlockedReason,
  getTikTokVideoDurationMessage,
  isTikTokVideoPath,
  parseTikTokCreatorInfo,
  TIKTOK_BRANDED_CONTENT_NOT_PRIVATE,
  TIKTOK_COMMERCIAL_SELECTION_REQUIRED,
  TikTokCreatorInfo,
} from './tiktok.direct-post';

const useTikTokCreatorInfo = (enabled: boolean, creatorKey: string) => {
  const { get } = useCustomProviderFunction();
  return useSWR<TikTokCreatorInfo>(
    enabled ? ['tiktok-creator-info', creatorKey] : null,
    async () => {
      const info = parseTikTokCreatorInfo(await get('creatorInfo'));
      if (!info) throw new Error('TikTok account settings are unavailable.');
      return info;
    },
    {
      revalidateOnMount: true,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 0,
      shouldRetryOnError: false,
      keepPreviousData: false,
    }
  );
};

// The shared visual Checkbox ignores disabled and has no keyboard interaction.
// A real input makes TikTok's creator restrictions enforceable and accessible.
const TikTokCheckbox: FC<{
  name: string;
  label: ReactNode;
  initialValue?: boolean;
  disabled?: boolean;
  tooltip?: string;
}> = ({ name, label, initialValue = false, disabled = false, tooltip }) => {
  const { register, watch, setValue, trigger, formState } = useSettings();
  const error = getTikTokCheckboxError(formState.errors[name]?.message);
  return (
    <div className="flex flex-col gap-[6px]">
      <label
        className={`flex items-start gap-[10px] text-[14px] ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        {...(tooltip ? { 'data-tooltip-id': 'tooltip', 'data-tooltip-content': tooltip } : {})}
      >
        <input
          type="checkbox"
          className="mt-[2px] h-[20px] w-[20px] shrink-0 accent-[#7357FF]"
          {...register(name, { value: initialValue })}
          checked={watch(name) === true}
          disabled={disabled}
          onChange={(event) => {
            setValue(name, event.target.checked, { shouldDirty: true });
            trigger(getTikTokFieldsToValidate(name));
          }}
        />
        <span>{label}</span>
      </label>
      {error && <div role="alert" className="text-red-400 text-[12px]">{error}</div>}
    </div>
  );
};

const TikTokSettings: FC<{ values?: any }> = () => {
  const { watch, register, setValue, formState } = useSettings();
  const { value, integration } = useIntegration();
  const setPublishBlocked = useLaunchStore((state) => state.setPublishBlocked);
  const t = useT();
  const isBusiness = integration?.identifier === 'tiktok-business';
  const media = value?.[0]?.image || [];
  const mediaKey = media.map((item) => item.path).join('|');
  const hasMedia = media.length > 0;
  const isVideo = hasMedia && media.every((item) => isBusiness
    ? item.path.indexOf('mp4') !== -1
    : isTikTokVideoPath(item.path));
  const isPhoto = hasMedia && !isVideo;
  const disclose = watch('disclose') === true;
  const autoAddMusic = watch('autoAddMusic');
  const ownBrand = watch('brand_organic_toggle') === true;
  const brandedContent = watch('brand_content_toggle') === true;
  const privacyLevel = watch('privacy_level') || '';
  const musicUsageConsent = watch('music_usage_consent') === true;
  const isUploadMode = watch('content_posting_method') === 'UPLOAD';
  const creatorKey = `${integration?.id}:${mediaKey}:${isUploadMode}`;
  const { data: loadedCreatorInfo, error: creatorError, isValidating, mutate: retryCreatorInfo } =
    useTikTokCreatorInfo(!isBusiness && !isUploadMode, creatorKey);
  // Cached capabilities are hidden while SWR verifies them for this composer.
  const creatorInfo = !isValidating && !creatorError ? loadedCreatorInfo : undefined;
  const [videoMetadata, setVideoMetadata] = useState<{
    key: string;
    duration?: number;
    failed?: boolean;
  }>();
  const videoDurationSeconds = videoMetadata?.key === mediaKey ? videoMetadata.duration : undefined;
  const metadataFailed = videoMetadata?.key === mediaKey && videoMetadata.failed;
  const directState = getTikTokDirectPostState({
    creatorInfo,
    mediaKind: !hasMedia ? 'none' : isVideo ? 'video' : 'photo',
    videoDurationSeconds,
    privacyLevel,
    disclose,
    ownBrand,
    brandedContent,
  });

  const publishBlockedReason = isBusiness || isUploadMode
    ? undefined
    : getTikTokPublishBlockedReason({
      state: directState,
      creatorInfo,
      creatorFailed: !!creatorError,
      mediaKind: !hasMedia ? 'none' : isVideo ? 'video' : 'photo',
      videoDurationSeconds,
      videoMetadataFailed: metadataFailed,
      musicUsageConsent,
    });

  useEffect(() => {
    if (!integration?.id) return;
    setPublishBlocked(integration.id, !!publishBlockedReason, publishBlockedReason);
  }, [integration?.id, publishBlockedReason, setPublishBlocked]);

  useEffect(() => () => {
    if (integration?.id) setPublishBlocked(integration.id, false);
  }, [integration?.id, setPublishBlocked]);

  useEffect(() => {
    setValue('__type', isBusiness ? 'tiktok-business' : 'tiktok');
    if (!isBusiness) {
      // Consent is specific to this composer session, never inherited from an
      // old draft or a previously submitted post.
      setValue('privacy_level', '');
      for (const name of ['music_usage_consent', 'comment', 'duet', 'stitch']) {
        setValue(name, false);
      }
    }
  }, [integration?.id, isBusiness, setValue]);

  useEffect(() => {
    if (isBusiness || isUploadMode || !isVideo) return;
    const video = document.createElement('video');
    let active = true;
    setVideoMetadata({ key: mediaKey });
    const timeout = window.setTimeout(() => {
      if (active) setVideoMetadata({ key: mediaKey, failed: true });
    }, 15000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      if (active) setVideoMetadata({ key: mediaKey, duration: video.duration });
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      if (active) setVideoMetadata({ key: mediaKey, failed: true });
    };
    video.src = media[0].path;
    return () => {
      active = false;
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [isBusiness, isUploadMode, isVideo, mediaKey]);

  useEffect(() => {
    if (isBusiness) return;
    setValue('creator_info_verified', directState.creatorReady, { shouldValidate: true });
    if (creatorInfo) {
      if (!directState.selectedPrivacyAllowed && privacyLevel) setValue('privacy_level', '', { shouldValidate: true });
      if (!directState.allowComment) setValue('comment', false, { shouldValidate: true });
      if (!directState.allowDuet) setValue('duet', false, { shouldValidate: true });
      if (!directState.allowStitch) setValue('stitch', false, { shouldValidate: true });
    }
  }, [isBusiness, creatorInfo, directState.creatorReady, directState.selectedPrivacyAllowed,
    directState.allowComment, directState.allowDuet, directState.allowStitch, privacyLevel, setValue]);

  useEffect(() => {
    if (isBusiness || disclose) return;
    setValue('brand_organic_toggle', false, { shouldValidate: true });
    setValue('brand_content_toggle', false, { shouldValidate: true });
  }, [isBusiness, disclose, setValue]);

  useEffect(() => {
    if (!isBusiness) setValue('music_usage_consent', false, { shouldValidate: true });
  }, [isBusiness, integration?.id, mediaKey, disclose, brandedContent, setValue]);

  const privacyLabels = useMemo(() => ({
    PUBLIC_TO_EVERYONE: t('public_to_everyone', 'Public to everyone'),
    MUTUAL_FOLLOW_FRIENDS: t('mutual_follow_friends', 'Mutual follow friends'),
    FOLLOWER_OF_CREATOR: t('follower_of_creator', 'Follower of creator'),
    SELF_ONLY: t('self_only', 'Only me'),
  }), [t]);
  const privacyOptions = isBusiness
    ? Object.keys(privacyLabels).map((entry) => ({ value: entry, disabled: false }))
    : directState.privacyOptions;
  const settingsDisabled = isUploadMode || (!isBusiness && !creatorInfo);
  // TikTok: branded content can't be private, so each choice locks the other
  const brandedPrivate = !isBusiness && disclose && brandedContent;
  const privateBlocksBranded = !isBusiness && privacyLevel === 'SELF_ONLY';
  const brandedContentPolicy = disclose && brandedContent;

  return (
    <div className="flex flex-col gap-[16px]">
      <input type="hidden" {...register('__type', { value: isBusiness ? 'tiktok-business' : 'tiktok' })} />
      {!isBusiness && <input type="hidden" {...register('creator_info_verified', { value: false })} />}
      <Select
        label={t('label_content_posting_method', 'Content posting method')}
        {...register('content_posting_method', { value: 'DIRECT_POST' })}
      >
        <option value="DIRECT_POST">{t('post_content_directly_to_tiktok', 'Post content directly to TikTok')}</option>
        <option value="UPLOAD">{t('upload_content_to_tiktok_without_posting', 'Upload content to TikTok without posting it')}</option>
      </Select>
      {isPhoto && <Input label="Title" {...register('title')} maxLength={90} />}
      {isUploadMode ? (
        <div className="bg-tableBorder p-[12px] rounded-[10px] text-[14px]" role="status">
          TikTok will notify you in your TikTok app inbox. Open that notification to edit and finish publishing; uploading here does not publish the post. Finish within 24 hours. Privacy, interaction, disclosure, AI and music settings below do not apply to inbox uploads.
          {isVideo && <p className="mt-[8px]">Add the caption inside TikTok before publishing.</p>}
        </div>
      ) : (
        <>
          {!isBusiness && (
            <div className="bg-tableBorder p-[12px] rounded-[10px] text-[14px]" aria-live="polite">
              {creatorInfo ? (
                <>
                  <div>Posting to <strong>{creatorInfo.creatorNickname}</strong>{creatorInfo.creatorUsername && ` (@${creatorInfo.creatorUsername})`}</div>
                  {isVideo && <div className="mt-[6px]">This account currently allows videos up to {creatorInfo.maxDurationSeconds} seconds.</div>}
                </>
              ) : creatorError ? (
                <>
                  <div role="alert">TikTok cannot confirm that this account can post right now. Try again later or reconnect the account.</div>
                  <button type="button" className="mt-[8px] underline" onClick={() => { void retryCreatorInfo(); }}>Retry account check</button>
                </>
              ) : 'Checking the latest TikTok account settings…'}
              {isVideo && creatorInfo && !directState.validDuration && (
                <div className="mt-[8px] text-red-400" role="alert">
                  {getTikTokVideoDurationMessage({
                    maxDurationSeconds: creatorInfo.maxDurationSeconds,
                    videoDurationSeconds,
                    videoMetadataFailed: metadataFailed,
                  })}
                </div>
              )}
              {!hasMedia && <div className="mt-[8px]">Add a photo or video to prepare your TikTok post.</div>}
            </div>
          )}
          {isVideo && <div className="text-[14px]">Your editable post content is used as the TikTok video caption.</div>}
          <div className="text-[14px]">Review the content preview and settings before posting. TikTok may take a few minutes to process the post before it appears on your profile.</div>
        </>
      )}
      <fieldset hidden={isUploadMode} disabled={settingsDisabled} className={isUploadMode ? 'hidden' : 'flex flex-col gap-[16px] min-w-0'}>
        <Select
          label={t('tiktok_who_can_see_post', 'Who can see this post?')}
          {...register('privacy_level', isBusiness ? { value: 'PUBLIC_TO_EVERYONE' } : {})}
          value={privacyLevel}
          {...(brandedPrivate ? { 'data-tooltip-id': 'tooltip', 'data-tooltip-content': TIKTOK_BRANDED_CONTENT_NOT_PRIVATE } : {})}
        >
          <option value="">{t('tiktok_choose_privacy', 'Select visibility')}</option>
          {privacyOptions.map((item) => (
            <option
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              title={item.disabled && item.value === 'SELF_ONLY' ? TIKTOK_BRANDED_CONTENT_NOT_PRIVATE : undefined}
            >
              {privacyLabels[item.value as keyof typeof privacyLabels] || item.value}
            </option>
          ))}
        </Select>
        {brandedPrivate && <div className="text-[13px]">{TIKTOK_BRANDED_CONTENT_NOT_PRIVATE} “{privacyLabels.SELF_ONLY}” is unavailable while Branded content is selected.</div>}
        {(isPhoto || isBusiness) && (
          <>
            <Select
              label={isBusiness ? t('label_add_random_music', 'Add random music') : t('label_auto_add_music', 'Auto add music')}
              {...register('autoAddMusic', { value: 'no' })}
            >
              <option value="no">{t('no', 'No')}</option>
              <option value="yes">{t('yes', 'Yes')}</option>
            </Select>
            <p className="text-[13px]">{isBusiness ? 'For photos only: add a random track from TikTok’s commercial music library.' : 'For photos only: TikTok can add recommended music.'}</p>
          </>
        )}
        {!isPhoto && !isBusiness && <input type="hidden" {...register('autoAddMusic', { value: 'no' })} />}
        {isBusiness && (
          <div className="flex flex-col gap-[16px]">
            <div hidden={!isVideo && autoAddMusic === 'yes'} className={!isVideo && autoAddMusic === 'yes' ? 'hidden' : undefined}>
              <TikTokMusicSelector label={t('tiktok_music_label', 'Music')} showVolumes={isVideo} {...register('music')} />
            </div>
            <TikTokLocationSelector label={t('tiktok_location_label', 'Location')} {...register('location')} />
          </div>
        )}
        <hr className="border-tableBorder" />
        <div className="text-[14px]">{t('tiktok_interactions', 'Interactions')}</div>
        <TikTokCheckbox
          name="comment"
          label={t('label_comments', 'Allow Comments')}
          initialValue={isBusiness}
          disabled={settingsDisabled || (!isBusiness && !directState.allowComment)}
        />
        {(isVideo || isBusiness) && (
          <>
            <TikTokCheckbox name="duet" label={t('label_duet', 'Allow Duet')} disabled={settingsDisabled || (!isBusiness && !directState.allowDuet)} />
            <TikTokCheckbox name="stitch" label={t('label_stitch', 'Allow Stitch')} disabled={settingsDisabled || (!isBusiness && !directState.allowStitch)} />
            <TikTokCheckbox name="video_made_with_ai" label={t('video_made_with_ai', 'Video made with AI')} disabled={settingsDisabled} />
          </>
        )}
        {!isVideo && !isBusiness && <>
          <input type="hidden" {...register('duet', { value: false })} />
          <input type="hidden" {...register('stitch', { value: false })} />
        </>}
        {!isBusiness && creatorInfo && (creatorInfo.commentDisabled || (isVideo && (creatorInfo.duetDisabled || creatorInfo.stitchDisabled))) && (
          <p className="text-[13px]">Greyed out interactions are disabled in this creator’s TikTok account settings.</p>
        )}
        <hr className="border-tableBorder" />
        <TikTokCheckbox name="disclose" label={t('tiktok_disclose_commercial', 'Disclose commercial content')} disabled={settingsDisabled} />
        <p className="text-[13px]">Turn on if this post promotes yourself, a brand, product or service in exchange for something of value.</p>
        <div hidden={!disclose} className={!disclose ? 'hidden' : 'flex flex-col gap-[12px]'}>
          <TikTokCheckbox name="brand_organic_toggle" label={t('label_your_brand', 'Your brand')} disabled={settingsDisabled} />
          <p className="text-[13px]">You are promoting yourself or your own business.</p>
          <TikTokCheckbox
            name="brand_content_toggle"
            label={t('label_branded_content', 'Branded content')}
            disabled={settingsDisabled || privateBlocksBranded}
            tooltip={privateBlocksBranded ? TIKTOK_BRANDED_CONTENT_NOT_PRIVATE : undefined}
          />
          <p className="text-[13px]">You are promoting another brand or a third party. Branded content cannot be private.</p>
          {privateBlocksBranded && (
            <p className="text-[13px]" role="status">
              Branded content is unavailable because this post is set to “{privacyLabels.SELF_ONLY}”. Choose another option under “Who can see this post?” to select it.
            </p>
          )}
          {!isBusiness && directState.commercialSelectionMissing && <p className="text-red-400 text-[13px]" role="alert">{TIKTOK_COMMERCIAL_SELECTION_REQUIRED}</p>}
          {directState.disclosureLabel && <p className="bg-tableBorder rounded-[10px] p-[10px] text-[14px]">{`Your ${isVideo ? 'video' : 'photo'} will be labeled as '${directState.disclosureLabel}'`}. This cannot be changed once posted.</p>}
        </div>
        {!isBusiness && (
          <TikTokCheckbox
            name="music_usage_consent"
            disabled={settingsDisabled}
            label="I authorize PostDelegate to upload and publish this content to the TikTok account shown above."
          />
        )}
        {(!isBusiness || (disclose && (ownBrand || brandedContent))) && (
          <p className="text-[14px]" data-testid="tiktok-declaration">
            {"By posting, you agree to TikTok's "}
            {brandedContentPolicy && <><a className="underline" target="_blank" rel="noopener noreferrer" href="https://www.tiktok.com/legal/page/global/bc-policy/en">Branded Content Policy</a> and </>}
            <a className="underline" target="_blank" rel="noopener noreferrer" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en">Music Usage Confirmation</a>
          </p>
        )}
      </fieldset>
      {!isBusiness && !isUploadMode && typeof formState.errors.creator_info_verified?.message === 'string' && <div role="alert" className="text-red-400 text-[12px]">{formState.errors.creator_info_verified.message}</div>}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: TikTokSettings,
  comments: false,
  CustomPreviewComponent: TiktokPreview,
  dto: TikTokDto,
  maximumCharacters: 2000,
  postSubmitMessage: (settings) =>
    settings?.content_posting_method === 'UPLOAD'
      ? 'It may take a few minutes for TikTok to process your upload before it appears in your TikTok inbox.'
      : "It may take a few minutes for TikTok to process your post before it's visible on your profile.",
});
