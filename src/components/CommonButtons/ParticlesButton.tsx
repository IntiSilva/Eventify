'use client';

import React from 'react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

export type ParticlesButtonProps =
  React.ComponentPropsWithoutRef<typeof Button> & {
    /** Glass effect background: solid black glass or fully transparent */
    glass?: 'black' | 'transparent';
    /** Opacity for the black glass background (0..1) */
    glassBlackAlpha?: number;
    /** Bottom glow color (e.g., 'rgba(16,185,129,0.5)') */
    glow?: string;
    /** Whether to render particle points */
    showPoints?: boolean;
    /** Distance (in px) each particle travels */
    pointsTravelPx?: number;
    /** Optional: particle color (defaults to white) */
    pointsColor?: string;
  };

export const ParticlesButton = React.forwardRef<
  React.ComponentRef<typeof Button>,
  ParticlesButtonProps
>(
  (
    {
      className,
      children,
      glass = 'black',
      glassBlackAlpha = 0.85,
      glow = 'rgba(16,185,129,0.5)',
      showPoints = true,
      pointsTravelPx = 55,
      pointsColor = '#fff',
      ...props
    },
    ref
  ) => {
    const base =
      glass === 'transparent'
        ? 'rgba(0,0,0,0)'
        : `rgba(0,0,0,${clamp01(glassBlackAlpha)})`;

    const layeredBg = `
      radial-gradient(70% 30% at 50% 100%, ${glow} 0%, rgba(0,0,0,0) 100%),
      linear-gradient(0deg, ${base}, ${base})
    `;

    // Same positions/durations as the original — we just generate 10 items
    const pts = new Array(10).fill(0);

    return (
      <Button
        ref={ref}
        className={cn(
          'relative overflow-hidden select-none',
          'bg-transparent hover:bg-transparent text-white',
          // border + white glow on hover (similar to BlobButton but white)
          'border border-white/40 hover:border-white/70',
          '[transition-property:box-shadow,transform,border-color] duration-300 ease-out',
          'shadow-[0_0_0_rgba(0,0,0,0)] hover:shadow-[0_2px_5px_rgba(255,255,255,0.85),_0_0_40px_rgba(255,255,255,0.35)]',
          'active:scale-[0.985]',
          className
        )}
        {...props}
      >
        {/* base background (glass + glow) */}
        <span aria-hidden className="pointer-events-none absolute inset-0 z-0" style={{ background: layeredBg }} />
        {/* inner re-fill (no highlight) */}
        <span aria-hidden className="pointer-events-none absolute inset-[2px] z-0 rounded-[inherit]" style={{ background: layeredBg }} />

        {/* particles (use global classes + CSS vars) */}
        {showPoints && (
          <div
            className="ugb-points"
            style={
              {
                '--ugb-travel': `${pointsTravelPx}px`,
                '--ugb-point-color': pointsColor,
              } as React.CSSProperties
            }
            aria-hidden
          >
            {pts.map((_, i) => <i key={i} className="point" />)}
          </div>
        )}

        {/* content */}
        <span className="relative z-20">{children}</span>
      </Button>
    );
  }
);

ParticlesButton.displayName = 'ParticlesButton';

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
