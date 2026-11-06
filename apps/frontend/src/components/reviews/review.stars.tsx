'use client';

import React, { FC } from 'react';
import clsx from 'clsx';

const Star: FC<{ filled: boolean; size: number }> = ({ filled, size }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 16.9l-5.25 2.8 1-5.85L3.5 9.7l5.9-.9L12 3.5z" />
  </svg>
);

export const StarsDisplay: FC<{ rating: number; size?: number }> = ({
  rating,
  size = 16,
}) => (
  <div className="flex gap-[2px] text-amber-400" aria-label={`${rating}/5`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star key={n} filled={n <= rating} size={size} />
    ))}
  </div>
);

export const StarsInput: FC<{
  value: number;
  onChange: (value: number) => void;
  label: (stars: number) => string;
}> = ({ value, onChange, label }) => (
  <div className="flex gap-[6px]" role="radiogroup">
    {[1, 2, 3, 4, 5].map((n) => (
      <button
        key={n}
        type="button"
        role="radio"
        aria-checked={value === n}
        aria-label={label(n)}
        title={label(n)}
        onClick={() => onChange(n)}
        className={clsx(
          'transition-colors',
          n <= value ? 'text-amber-400' : 'text-textItemBlur hover:text-amber-400'
        )}
      >
        <Star filled={n <= value} size={32} />
      </button>
    ))}
  </div>
);
