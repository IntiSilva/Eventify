'use client';

import { cn } from '@/lib/utils';
import styles from './MyTicketCard.module.css';

type MyTicketCardSkeletonProps = {
  className?: string;
};

export default function MyTicketCardSkeleton({ className }: MyTicketCardSkeletonProps) {
  return (
    <article
      aria-hidden="true"
      className={cn(
        styles.ticketCardFrame,
        styles.ticketCardCurrent,
        'h-[231px] md:h-[232px] pointer-events-none',
        className
      )}
    >
      <div className={cn(styles.ticketCardShell, 'flex h-full flex-col')}>
        <div className="space-y-1.5">
          <div className="skeleton h-4 w-[78%]" />
          <div className="skeleton h-4 w-[62%]" />
        </div>

        <div className="mt-2 space-y-1 px-2">
          <div className="flex items-center gap-1.5">
            <span className="skeleton h-3.5 w-3.5 rounded-full" />
            <span className="skeleton h-3.5 w-[64%]" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="skeleton h-3.5 w-3.5 rounded-full" />
            <span className="skeleton h-3.5 w-[72%]" />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="skeleton h-6 w-20 rounded-full" />
          <span className="skeleton h-4 w-16" />
        </div>

        <div className="mt-2 space-y-1 px-2">
          <div className="skeleton h-3 w-[58%]" />
          <div className="skeleton h-3 w-[52%]" />
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          <span className="skeleton h-8 w-28 rounded-full" />
          <span className="skeleton h-8 w-24 rounded-full" />
        </div>
      </div>
    </article>
  );
}
