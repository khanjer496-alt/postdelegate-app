'use client';

import { FC } from 'react';
import {
  fromUtc,
  getTimezone,
  timezoneOffset,
} from '@gitroom/frontend/components/layout/set.timezone';

// the timezone goes with the time: a client reviewing the preview may be in
// another one than the team that scheduled it
export const RenderPreviewDate: FC<{ date: string }> = ({ date }) => {
  const day = fromUtc(date);
  const timezone = getTimezone();
  return (
    <>
      {day.format('MMMM D, YYYY h:mm A')}{' '}
      <span className="text-textItemBlur">
        {timezone} ({timezoneOffset(timezone, day.valueOf())})
      </span>
    </>
  );
};
