'use client';

import { motion, useAnimation } from 'motion/react';
import { useEffect } from 'react';
import { useMediaQuery } from '@/lib/hooks';

type LinesBackgroundProps = {
  /** Delay in seconds for mobile (<768px). Default: 0 */
  delayMobile?: number;
  /** Delay in seconds for desktop (>=768px). Default: 0 */
  delayDesktop?: number;
};

/**
 * Animated SVG lines background used in auth pages.
 * - Desktop: single stroked path + drop shadow (original neon look).
 * - Mobile: black core line + emerald halo, no CSS filters for better performance.
 */
export default function LinesBackground({
  delayMobile = 0,
  delayDesktop = 0,
}: LinesBackgroundProps) {
  const pathControls = useAnimation();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // Choose delay based on viewport
  const delay = isDesktop ? delayDesktop : delayMobile;

  useEffect(() => {
    const sequence = async () => {
      // Ensure initial state
      pathControls.set({ pathLength: 0 });
      // Start with configurable delay
      await pathControls.start({
        pathLength: 1,
        transition: { delay, duration: 2.5, ease: 'easeInOut' },
      });
    };
    sequence();
  }, [pathControls, delay]);

  // Path shape and viewBox differ slightly between desktop and mobile
  const pathDefinition = isDesktop
    ? 'M 0 500 Q 200 600 450 500 Q 650 400 300 150 Q 250 100 400 120 Q 800 600 1000 300'
    : 'M 0 -200 Q 200 100 450 -200 Q 650 -500 50 -850 Q 250 -900 400 -880 Q 800 -400 1000 -700';

  const viewBox = isDesktop ? '0 0 1000 1000' : '0 -700 1000 1100';

  // Vertical offsets to draw three parallel lines
  const offsets = [-14, 0, 14];

  return (
    <div className="absolute left-0 top-0 w-full h-screen pointer-events-none">
      <svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid slice"
        className="overflow-visible"
      >
        <g>
          {offsets.map((yOffset) => (
            <g key={`line-group-${yOffset}`}>
              {isDesktop ? (
                // ===== DESKTOP: black line + drop shadow (original look) =====
                <motion.path
                  d={pathDefinition}
                  fill="none"
                  stroke="black"
                  strokeWidth={6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    filter:
                      'drop-shadow(1px 0 2px rgba(16,185,129,0.9))',
                  }}
                  transform={`translate(0 ${yOffset})`}
                  initial={{ pathLength: 0 }}
                  animate={pathControls}
                />
              ) : (
                // ===== MOBILE: black core + emerald halo (no CSS filters) =====
                <>
                  {/* Outer glow: uses the same emerald tone as the form,
                      but with opacity so it’s not too aggressive */}
                  <motion.path
                    d={pathDefinition}
                    fill="none"
                    stroke="rgba(16,185,129,0.5)" // soft “neon” emerald
                    strokeWidth={8} // slightly wider than the black core
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    transform={`translate(0 ${yOffset})`}
                    initial={{ pathLength: 0 }}
                    animate={pathControls}
                  />
                  {/* Inner black core (matches the original design) */}
                  <motion.path
                    d={pathDefinition}
                    fill="none"
                    stroke="black"
                    strokeWidth={4} // thinner so the halo is visible around it
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    transform={`translate(0 ${yOffset})`}
                    initial={{ pathLength: 0 }}
                    animate={pathControls}
                  />
                </>
              )}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
