'use client';

import { useMediaQuery } from "@/lib/hooks";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import { Flame } from "lucide-react";

interface Props {
  variant?: 'carousel' | 'list';
}

// Blob configurations for each breakpoint
const baseAdminBadgeBlobs = [
  { style: { width: '12px', height: '12px', top: '2px', left: '18px', animation: 'moveBadgeBlob1 15s infinite alternate ease-in-out' }, colorClass: 'bg-red-500' },
  { style: { width: '15px', height: '15px', top: '8px', left: '2px', animation: 'moveBadgeBlob2 20s infinite alternate ease-in-out -5s' }, colorClass: 'bg-rose-500' },
];
const mobileAdminBadgeBlobs = [
  { style: { width: '16px', height: '16px', top: '3px', left: '25px', animation: 'moveBadgeBlob1 15s infinite alternate ease-in-out' }, colorClass: 'bg-red-500' },
  { style: { width: '20px', height: '20px', top: '12px', left: '3px', animation: 'moveBadgeBlob2 20s infinite alternate ease-in-out -5s' }, colorClass: 'bg-rose-500' },
];
const desktopAdminBadgeBlobs = [
  { style: { width: '20px', height: '20px', top: '5px', left: '30px', animation: 'moveBadgeBlob1 15s infinite alternate ease-in-out' }, colorClass: 'bg-red-500' },
  { style: { width: '25px', height: '25px', top: '15px', left: '5px', animation: 'moveBadgeBlob2 20s infinite alternate ease-in-out -5s' }, colorClass: 'bg-rose-500' },
];

export default function AdminFeaturedBadge({ variant = 'carousel' }: Props) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isMobile = useMediaQuery('(min-width: 390px)');

  const adminBadgeBlobs = isDesktop
    ? desktopAdminBadgeBlobs
    : isMobile
      ? mobileAdminBadgeBlobs
      : baseAdminBadgeBlobs;

  /* === layout-dependent classes === */
  const sizeClasses =
    variant === 'list'
      ? 'px-2 xs3:px-3 md:px-4 py-1 xs3:py-1 md:py-1.5 rounded-sm xs3:rounded-md'
      : 'px-1 xs3:px-1.5 md:px-2.5 py-0.5 xs3:py-0.5 md:py-1 rounded-[4px] xs3:rounded-sm';

  const iconClasses =
    variant === 'list'
      ? 'h-[9px] w-[9px] xs3:h-[10px] xs3:w-[10px] md:h-4 md:w-4'
      : 'h-[7px] w-[7px] xs3:h-2 xs3:w-2 md:h-3 md:w-3';

  const textClasses =
    variant === 'list'
      ? 'text-[9px] xs3:text-2xs md:text-[12px]'
      : 'text-[7px] xs3:text-3xs md:text-[11px]';

  return (
    <Badge
      variant="default"
      className={cn(
        'relative rounded-[4px] xs3:rounded-sm overflow-hidden bg-transparent text-white border-red-900 shadow-md cursor-default',
        sizeClasses,
      )}
    >
      {/*1. Responsive blur: Less blur on small screens for more presence. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black [filter:blur(4px)_contrast(25)] xs3:[filter:blur(6px)_contrast(25)]"
      >
        <div className="relative w-full h-full">
          {adminBadgeBlobs.map((blob, index) => (
            // 2. Responsive opacity: More opaque on small screens.
            <div
              key={index}
              style={blob.style}
              className={cn('absolute rounded-full opacity-100 xs3:opacity-80', blob.colorClass)}
            />
          ))}
        </div>
      </div>
      <div className="relative z-10 flex items-center gap-0.5">
        <Flame className={cn('max-xs3:mb-0.5', iconClasses)} />
        <p className={cn('font-semibold', textClasses)}>Admin&apos;s Pick</p>
      </div>
    </Badge>
  );
}
