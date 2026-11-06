'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { DribbbleTeams } from '@gitroom/frontend/components/new-launch/providers/dribbble/dribbble.teams';
import { DribbbleDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
const DribbbleSettings: FC = () => {
  const t = useT();
  const { register, control } = useSettings();
  return (
    <div className="flex flex-col">
      {/* the same sizes the provider checks and crops to (SHOT_SIZES) */}
      <div className="text-[14px] text-textItemBlur mb-[12px]">
        {t(
          'dribbble_shot_size_hint',
          'Dribbble shots are one image of exactly 800×600 or 400×300 px. Other images of at least 400×300 are cropped from the center to fit; GIFs must already be one of these sizes.'
        )}
      </div>
      <Input label={'Title'} {...register('title')} />
      <DribbbleTeams {...register('team')} />
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  // no follow-ups: the network has no comment endpoint, they would be dropped
  comments: false,
  SettingsComponent: DribbbleSettings,
  CustomPreviewComponent: undefined,
  dto: DribbbleDto,
  maximumCharacters: 40000,
});
