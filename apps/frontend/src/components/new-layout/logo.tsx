'use client';

import SafeImage from '@gitroom/react/helpers/safe.image';

export const Logo = () => {
  return (
    <SafeImage
      src="/postdelegate-mark.svg"
      width={60}
      height={60}
      alt="PostDelegate"
      className="mt-[8px] min-w-[60px] min-h-[60px]"
    />
  );
};
