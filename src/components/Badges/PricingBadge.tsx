'use client';

import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  isPaid: boolean;
  variant?: 'carousel' | 'list' | 'menu';
  className?: string;
}

export default function PricingBadge({ isPaid, variant = 'carousel', className }: Props) {
  // Match AdminFeaturedBadge sizing conventions so header badges align
  const sizeClasses =
    variant === 'list'
      ? 'px-2 xs3:px-3 md:px-4 py-1 xs3:py-1 md:py-1.5 rounded-sm xs3:rounded-md text-[9px] xs3:text-2xs md:text-[12px]'
      : ( variant === 'carousel'
        ? 'px-1 md:px-2.5 py-0.5 md:py-1 rounded-[4px] xs3:rounded-sm text-[7px] md:text-[11px]'
        : 'px-1 xs3:px-1.5 md:px-1.5 py-0.5 xs3:py-0.5 md:py-0.5 rounded-[4px] xs3:rounded-sm text-[7px] xs3:text-3xs md:text-2xs'
         )

  const base = cn(
    'relative overflow-hidden text-white shadow-sm cursor-default border-zinc-800',
    sizeClasses,
    className,
  );

  if (isPaid) {
    return (
      <Badge className={cn(base, 'bg-violet-400/10 border border-violet-300/25 text-violet-200')}>
        <span className="font-semibold flex items-center gap-1">Paid</span>
      </Badge>
    );
  }

  return (
    <Badge className={cn(base, 'bg-emerald-400/10 border border-emerald-300/25 text-emerald-200')}>
      <span className="font-medium">Free</span>
    </Badge>
  );
}
