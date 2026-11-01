'use client';

import { FC, useCallback, useRef } from 'react';
import dayjs from 'dayjs';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { MediumTags } from '@gitroom/frontend/components/new-launch/providers/medium/medium.tags';
import { useWatch } from 'react-hook-form';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Select } from '@gitroom/react/form/select';
import { YoutubePreview } from '@gitroom/frontend/components/new-launch/providers/youtube/youtube.preview';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { DatePicker } from '@gitroom/frontend/components/launches/helpers/date.picker';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import {
  fromUtc,
  newDayjs,
} from '@gitroom/frontend/components/layout/set.timezone';
const type = [
  {
    label: 'Public',
    value: 'public',
  },
  {
    label: 'Private',
    value: 'private',
  },
  {
    label: 'Unlisted',
    value: 'unlisted',
  },
];

const yesNo = [
  {
    label: 'No',
    value: 'no',
  },
  {
    label: 'Yes',
    value: 'yes',
  },
];
// YouTube makes the private upload public at this time, stored in UTC
const PublishLater: FC = () => {
  const t = useT();
  const { control, setValue, formState } = useSettings();
  const { date } = useIntegration();
  // the checkbox only refreshes its click handler when it flips, so the post
  // date (which can change meanwhile) is read here
  const postDate = useRef(date);
  postDate.current = date;
  const publishAt = useWatch({ control, name: 'publishAt' });
  const error = formState.errors.publishAt?.message;

  const change = useCallback(
    (value?: dayjs.Dayjs) => {
      setValue('publishAt', value ? value.utc().format() : undefined, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [setValue]
  );

  // a day after the post (or after now, for a post in the past)
  const toggle = useCallback(() => {
    if (publishAt) {
      change();
      return;
    }
    const now = newDayjs();
    const from = postDate.current.isAfter(now) ? postDate.current : now;
    change(from.add(1, 'day').startOf('hour'));
  }, [publishAt, change]);

  return (
    <div className="mt-[20px] flex flex-col gap-[10px]">
      <Checkbox
        disableForm={true}
        checked={!!publishAt}
        onChange={toggle}
        label={t('youtube_publish_later', 'Publish later on YouTube')}
      />
      {!!publishAt && (
        <>
          <div className="flex">
            <DatePicker date={fromUtc(publishAt)} onChange={change} />
          </div>
          <div className="text-[12px] opacity-70">
            {t(
              'youtube_publish_later_note',
              'The video is uploaded as private at the post time, and YouTube makes it public at this time.'
            )}
          </div>
        </>
      )}
      {typeof error === 'string' && !!error && (
        <div role="alert" className="text-red-400 text-[12px]">
          {error}
        </div>
      )}
    </div>
  );
};

const YoutubeSettings: FC = () => {
  const t = useT();
  const { register, control, setValue } = useSettings();
  // the thumbnail is set from the media settings now, older posts may still
  // carry one here, and it wins over the media thumbnail
  const thumbnail = useWatch({ control, name: 'thumbnail' });
  // with "publish later", the upload is private and YouTube picks the time
  const publishAt = useWatch({ control, name: 'publishAt' });
  return (
    <div className="flex flex-col">
      <Input label="Title" {...register('title')} maxLength={100} />
      <div className={publishAt ? 'hidden' : ''}>
        <Select
          label="Type"
          {...register('type', {
            value: 'public',
          })}
        >
          {type.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>
      <Select
        label="Made for kids"
        {...register('selfDeclaredMadeForKids', {
          value: 'no',
        })}
      >
        {yesNo.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <Select
        label={t(
          'youtube_contains_synthetic_media',
          'This video contains realistic altered or synthetic content'
        )}
        hideErrors={true}
        {...register('containsSyntheticMedia', {
          value: 'no',
        })}
      >
        {yesNo.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <div className="text-[12px] opacity-70 mt-[8px] mb-[20px]">
        {t(
          'youtube_contains_synthetic_media_note',
          'YouTube requires this when realistic content was made or meaningfully changed with AI or other tools, for example a real person saying or doing something they did not, altered footage of a real event or place, or a realistic scene that never happened. Not needed for animation, fantasy, beauty filters or AI help with scripts and ideas.'
        )}
      </div>
      <MediumTags label="Tags" {...register('tags')} />
      <PublishLater />
      {!!thumbnail?.path && (
        <div className="mt-[20px] flex items-center gap-[10px] text-[12px]">
          <div className="flex-1">
            {t(
              'youtube_thumbnail_overrides_media',
              'This post has a YouTube-specific thumbnail, which overrides the thumbnail set in the media settings.'
            )}
          </div>
          <div
            onClick={() =>
              setValue('thumbnail', undefined, { shouldDirty: true })
            }
            className="cursor-pointer text-[#FF3F3F] font-[600]"
          >
            {t('remove', 'Remove')}
          </div>
        </div>
      )}
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: YoutubeSettings,
  CustomPreviewComponent: YoutubePreview,
  dto: YoutubeSettingsDto,
  maximumCharacters: 5000,
});
