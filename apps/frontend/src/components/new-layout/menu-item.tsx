'use client';
import { FC, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import Link from 'next/link';

export const MenuItem: FC<{
  label: string;
  title?: string;
  icon: ReactNode;
  path: string;
  onClick?: () => void;
  // a count shown on the icon, e.g. posts waiting for review
  badge?: number;
}> = ({ label, title, icon, path, onClick, badge }) => {
  const currentPath = usePathname();
  const isActive = currentPath.indexOf(path) === 0;

  const className = clsx(
    'group w-full minCustom:h-[54px] custom:h-[44px] py-[8px] px-[6px] minCustom:gap-[4px] custom:gap-[2px] flex flex-col font-[600] items-center justify-center rounded-[12px] hover:text-textItemFocused hover:bg-boxFocused transition-colors',
    isActive
      ? 'relative menu-orbit-dot text-textItemFocused bg-boxFocused'
      : 'text-textItemBlur'
  );

  const inner = (
    <>
      <div
        className="relative custom:scale-90 transition-transform"
        aria-hidden="true"
      >
        {icon}
        {!!badge && (
          <span className="absolute -top-[6px] -end-[10px] min-w-[16px] h-[16px] px-[4px] rounded-full bg-btnCta text-btnCtaText text-[10px] leading-[16px] font-[700] text-center">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <div className="custom:text-[9px] minCustom:text-[10px] leading-[1.1] text-center">
        {label}
        {!!badge && <span className="sr-only"> ({badge})</span>}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title || label}
        className={className}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      title={title || label}
      aria-current={isActive ? 'page' : undefined}
      {...path.indexOf('http') === 0 && { target: '_blank' }}
      className={className}
    >
      {inner}
    </Link>
  );
};
