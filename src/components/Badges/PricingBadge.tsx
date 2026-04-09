'use client';

import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';

export type PricingBadgeState = 'in_progress' | 'ended' | 'paid' | 'free';

type ResolvePricingBadgeStateInput = {
  isPaid: boolean;
  eventStart: string | Date;
  now?: Date;
};

const IN_PROGRESS_WINDOW_MS = 8 * 60 * 60 * 1000;

export function resolvePricingBadgeState({
  isPaid,
  eventStart,
  now = new Date(),
}: ResolvePricingBadgeStateInput): PricingBadgeState {
  const eventStartMs =
    eventStart instanceof Date ? eventStart.getTime() : new Date(eventStart).getTime();

  if (Number.isNaN(eventStartMs)) {
    return isPaid ? 'paid' : 'free';
  }

  const elapsedMs = now.getTime() - eventStartMs;

  if (elapsedMs >= 0 && elapsedMs <= IN_PROGRESS_WINDOW_MS) {
    return 'in_progress';
  }

  if (elapsedMs > IN_PROGRESS_WINDOW_MS) {
    return 'ended';
  }

  return isPaid ? 'paid' : 'free';
}

interface Props {
  isPaid: boolean;
  eventStart: string | Date;
  variant?: 'carousel' | 'list' | 'menu';
  className?: string;
}

export default function PricingBadge({
  isPaid,
  eventStart,
  variant = 'carousel',
  className,
}: Props) {
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

  const state = resolvePricingBadgeState({ isPaid, eventStart });

  if (state === 'in_progress') {
    return (
      <Badge className={cn(base, 'bg-sky-950/50 border border-sky-300/50 text-sky-200')}>
        <span className="font-medium">In Progress</span>
      </Badge>
    );
  }

  if (state === 'ended') {
    return (
      <Badge className={cn(base, 'bg-amber-950/50 border border-amber-300/50 text-amber-200')}>
        <span className="font-medium">Ended</span>
      </Badge>
    );
  }

  if (state === 'paid') {
    return (
      <Badge className={cn(base, 'bg-indigo-950/50 border border-indigo-300/50 text-indigo-200')}>
        <span className="font-semibold flex items-center gap-1">Paid</span>
      </Badge>
    );
  }

  return (
    <Badge className={cn(base, 'bg-emerald-950/50 border border-emerald-300/50 text-emerald-200')}>
      <span className="font-medium">Free</span>
    </Badge>
  );
}
