import React from 'react';
import SafeImage from '@gitroom/react/helpers/safe.image';

export const LogoTextComponent = () => {
  return (
    <span className="inline-flex items-center gap-[10px] text-current">
      <SafeImage src="/postdelegate-mark.svg" width={33} height={33} alt="" />
      <span className="text-[22px] font-[700] tracking-tight">PostDelegate</span>
    </span>
  );
};
