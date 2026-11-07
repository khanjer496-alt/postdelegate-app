'use client';

import React, { FC } from 'react';

const isVideo = (path: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(path);

export const IdeaMediaThumb: FC<{ path: string; size?: number }> = ({
  path,
  size = 48,
}) => {
  const style = { width: size, height: size };
  return isVideo(path) ? (
    <video
      src={path}
      style={style}
      muted={true}
      preload="metadata"
      className="rounded-[8px] object-cover bg-newBgColor"
    />
  ) : (
    <img
      src={path}
      alt=""
      loading="lazy"
      style={style}
      className="rounded-[8px] object-cover bg-newBgColor"
    />
  );
};
