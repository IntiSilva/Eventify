'use client';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  variant?: 'list' | 'carousel';
  visible?: boolean;
};

export default function ArcEventCardSkeleton({ variant = 'list', visible = true }: Props) {
  const isList = variant === 'list';

  return (
     <div
      aria-hidden
      className={cn(
        // fade
        'transition-opacity duration-200 ease-in',
        visible ? 'opacity-100' : 'opacity-0',
        // size wrapper
        isList ? 'h-[335px] md:h-[505px]' : 'h-full'
      )}
    >
      <Card className="h-full bg-black border border-zinc-700 flex flex-col">
        <CardContent
          className={cn(
            'relative flex flex-col h-full md:py-4',
            isList ? 'px-1.5 xs3:px-2.5 md:px-3' : 'px-1 xs3:px-2 md:px-2.5',
          )}
        >
          {/* Category badge (siempre existe en el card real) */}
          <div className="absolute -top-5.5 left-1.5 md:-top-4.5 md:left-2.5 z-10">
            <div
              className={cn(
                isList ? 'h-5 w-20 md:h-7 md:w-28' : 'h-4 w-16 md:h-6 md:w-20',
                'skeleton !rounded-sm',
              )}
            />
          </div>

          {/* Content */}
          <div className="flex flex-col flex-grow md:space-y-3">
            {/* Title block (mismos min-heights) */}
            <div
              className={cn(
                'flex items-center justify-center',
                isList ? 'min-h-24 md:min-h-36' : 'min-h-32 md:min-h-36',
              )}
            >
              <div
                className={cn(
                  isList ? 'h-6 md:h-8 w-4/5 md:w-3/4' : 'h-5 md:h-7 w-3/4 md:w-2/3',
                  'skeleton',
                )}
              />
            </div>

            {/* Description (mismos altos) */}
            <div className="h-10 md:h-16">
              <div className="space-y-1.5">
                <div className="h-3 md:h-4 w-full skeleton" />
                <div className="h-3 md:h-4 w-5/6 md:w-4/5 skeleton" />
              </div>
            </div>

            {/* Meta */}
            <div className="space-y-1.5 md:space-y-2.5">
              {/* Date */}
              <div
                className={cn(
                  isList ? 'h-3.5 md:h-5 w-3/5' : 'h-3 md:h-4 w-1/2',
                  'skeleton',
                )}
              />

              {/* Creator row */}
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    isList ? 'h-3.5 md:h-5 w-20 md:w-28' : 'h-3 md:h-4 w-16 md:w-24',
                    'skeleton',
                  )}
                />
                <div
                  className={cn(
                    isList ? 'size-5 md:size-7' : 'size-5 md:size-6',
                    '!rounded-full skeleton',
                  )}
                />
              </div>

              {/* Attendees (placeholder “común”) */}
              <div>
                <div
                  className={cn(
                    'mb-1',
                    isList ? 'h-3 md:h-4 w-16' : 'h-2.5 w-14',
                    'skeleton',
                  )}
                />
                <div
                  className={cn(
                    isList ? 'h-6 md:h-10 w-24 md:w-36' : 'h-5 md:h-9 w-20 md:w-32',
                    'skeleton',
                  )}
                />
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="flex justify-end mt-auto max-md:pb-1.5 pt-2">
            <div
              className={cn(
                isList ? 'h-8 md:h-10 w-20 md:w-24' : 'h-7 md:h-9 w-16 md:w-20',
                'skeleton !rounded-md',
              )}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
