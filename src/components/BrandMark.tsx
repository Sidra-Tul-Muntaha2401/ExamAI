import React from 'react';

interface BrandMarkProps {
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
}

export function BrandMark({ variant = 'light', size = 'md' }: BrandMarkProps) {
  const isDark = variant === 'dark';

  const iconSize =
    size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-8 h-8' : 'w-7 h-7';
  const textSize =
    size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-2xl' : 'text-[21px]';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={`${iconSize} shrink-0`}
      >
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="8"
          fill={isDark ? '#303030' : '#171717'}
          stroke={isDark ? 'rgba(223,197,142,0.28)' : '#171717'}
          strokeWidth="1"
        />
        {/* Open scholarly folio + architectural apex diamond */}
        <path
          d="M8.5 10.75C8.5 10.06 9.06 9.5 9.75 9.5H14.5C15.33 9.5 16 10.17 16 11V22.25C15.15 21.6 14.08 21.25 12.95 21.25H9.75C9.06 21.25 8.5 20.69 8.5 20V10.75Z"
          fill="#FFFFFF"
          fillOpacity="0.95"
        />
        <path
          d="M23.5 10.75C23.5 10.06 22.94 9.5 22.25 9.5H17.5C16.67 9.5 16 10.17 16 11V22.25C16.85 21.6 17.92 21.25 19.05 21.25H22.25C22.94 21.25 23.5 20.69 23.5 20V10.75Z"
          fill="#C9A45C"
        />
        <path
          d="M16 6.75L18.1 8.85L16 10.95L13.9 8.85L16 6.75Z"
          fill="#DFC58E"
        />
      </svg>
      <span
        className={`${textSize} font-display font-bold tracking-[-0.03em] leading-none whitespace-nowrap shrink-0 ${
          isDark ? 'text-white' : 'text-[#252525]'
        }`}
      >
        Exam<span className={isDark ? 'text-[#C9A45C]' : 'text-[#66543A]'}>AI</span>
      </span>
    </span>
  );
}
