'use client';

import React from 'react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/hooks';

export type BlobButtonProps = React.ComponentPropsWithoutRef<typeof Button>;
type ButtonRef = React.ComponentRef<typeof Button>;


const baseBlobs = [
  { style: { width: '12px', height: '12px', top: '2px',  left: '18px', animation: 'moveButtonBlob1 15s infinite alternate ease-in-out' }, colorClass: 'bg-red-500' },
  { style: { width: '15px', height: '15px', top: '8px',  left: '2px',  animation: 'moveButtonBlob2 20s infinite alternate ease-in-out -5s' }, colorClass: 'bg-rose-500' },
];
const mobileBlobs = [
  { style: { width: '16px', height: '16px', top: '3px',  left: '25px', animation: 'moveButtonBlob1 15s infinite alternate ease-in-out' }, colorClass: 'bg-red-500' },
  { style: { width: '20px', height: '20px', top: '12px', left: '3px',  animation: 'moveButtonBlob2 20s infinite alternate ease-in-out -5s' }, colorClass: 'bg-rose-500' },
];
const desktopBlobs = [
  { style: { width: '20px', height: '20px', top: '5px',  left: '30px', animation: 'moveButtonBlob1 15s infinite alternate ease-in-out' }, colorClass: 'bg-red-500' },
  { style: { width: '25px', height: '25px', top: '15px', left: '5px',  animation: 'moveButtonBlob2 20s infinite alternate ease-in-out -5s' }, colorClass: 'bg-rose-500' },
];

export const BlobButton = React.forwardRef<ButtonRef, BlobButtonProps>(
  ({ className, children, ...props }, ref) => {
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const isMobile  = useMediaQuery('(min-width: 390px)');
    const blobs = isDesktop ? desktopBlobs : isMobile ? mobileBlobs : baseBlobs;

    return (
      <Button
        ref={ref}
        className={cn(
          // base layout + look
          'relative overflow-hidden bg-transparent hover:bg-transparent border border-red-900 rounded-[8px]',
          // smooth transition ONLY for shadow/border/transform
          '[transition-property:box-shadow,transform,border-color] duration-300 ease-out',
          'shadow-[0_0_0_rgba(0,0,0,0)] hover:shadow-[0_2px_5px_rgba(239,68,68,0.8),_0_0_40px_rgba(239,68,68,0.35)]',
          'hover:border-red-600 active:scale-[0.985]',
          className
        )}
        {...props}
      >
        {/* blur layer + blobs */}
        <div aria-hidden className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-black [filter:blur(4px)_contrast(25)] xs3:[filter:blur(6px)_contrast(25)] md:[filter:blur(7px)_contrast(25)]">
            <div className="relative w-full h-full">
              {blobs.map((blob, i) => (
                <div
                  key={i}
                  style={blob.style}
                  className={cn('absolute rounded-full opacity-100 xs3:opacity-80', blob.colorClass)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* foreground */}
        <span className="relative z-10">{children}</span>
      </Button>
    );
  }
);

BlobButton.displayName = 'BlobButton';
