'use client';

import { FC } from 'react';

// PostDelegate orbit loader: a violet orbit with the lime signal dot riding it,
// the same motif as the logo. Motion lives in global.scss (.orbit-loader-*)
// and falls back to a soft pulse for prefers-reduced-motion.
const Spinner: FC<{
  type?: string;
  color?: string;
  width?: number;
  height?: number;
}> = ({ color = 'var(--new-btn-primary)', width = 100, height = 100 }) => {
  const size = Math.min(width, height);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="status"
      aria-label="Loading"
      className="orbit-loader"
    >
      <circle
        cx="24"
        cy="24"
        r="19"
        stroke={color}
        strokeOpacity="0.18"
        strokeWidth="3"
      />
      <g className="orbit-loader-counter">
        <circle
          cx="24"
          cy="24"
          r="11"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="12 6"
        />
      </g>
      <g className="orbit-loader-spin">
        <path
          d="M24 5a19 19 0 0 1 19 19"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle
          cx="43"
          cy="24"
          r="3.6"
          fill="var(--new-orbit-dot)"
          stroke="var(--new-orbit-ring)"
          strokeWidth="1.8"
        />
      </g>
    </svg>
  );
};

export { Spinner as default };

export const LoadingComponent: FC<{
  width?: number;
  height?: number;
}> = (props) => {
  return (
    <div className="flex-1 flex justify-center pt-[100px]">
      <Spinner width={props.width || 100} height={props.height || 100} />
    </div>
  );
};
