'use client';

import {
  ButtonHTMLAttributes,
  DetailedHTMLProps,
  FC,
  useEffect,
  useRef,
  useState,
} from 'react';
import { clsx } from 'clsx';
// orbit loader, same motif as the app loader, drawn in the button text colour
const ReactLoading = ({ width = 20, height = 20 }: { type?: string; color?: string; width?: number; height?: number }) => {
  const size = Math.min(width, height);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="status" aria-label="Loading" className="orbit-loader">
      <circle cx="24" cy="24" r="19" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <g className="orbit-loader-spin">
        <path d="M24 5a19 19 0 0 1 19 19" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <circle cx="43" cy="24" r="5" fill="currentColor" />
      </g>
    </svg>
  );
};
export const Button: FC<
  DetailedHTMLProps<
    ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > & {
    secondary?: boolean;
    loading?: boolean;
    innerClassName?: string;
  }
> = ({ children, loading, innerClassName, secondary, ...props }) => {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    setHeight(ref.current?.offsetHeight || 40);
  }, []);
  return (
    <button
      {...props}
      type={props.type || 'button'}
      ref={ref}
      className={clsx(
        (props.disabled || loading) && 'opacity-50 pointer-events-none',
        `${
          secondary ? 'bg-third' : 'bg-btnCta shadow-cta text-btnCtaText font-[600]'
        } px-[24px] h-[40px] cursor-pointer items-center justify-center flex relative`,
        props?.className
      )}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <ReactLoading
            type="spin"
            width={height! / 2}
            height={height! / 2}
          />
        </div>
      )}
      <div
        className={clsx(
          innerClassName,
          'flex-1 items-center justify-center flex',
          loading && 'invisible'
        )}
      >
        {children}
      </div>
    </button>
  );
};
