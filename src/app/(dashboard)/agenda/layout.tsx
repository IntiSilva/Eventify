import React from 'react';
import PlasmaBackground from '@/components/AnimatedBackgrounds/PlasmaBackground';

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-agenda-page is used to hide the scrollbar only on desktop when at /agenda
    <div data-agenda-page className="relative min-h-dvh">
      {/* Fixed background behind everything (does not block interactions) */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <PlasmaBackground
          color="#10B981"
          direction="forward"      // subtle flow, no ping-pong
          speed={0.35}             // desktop: gentle motion
          scale={0.9}              // desktop: slightly closer than 0.8
          opacity={0.14}           // subtle so it doesn't wash the UI
          mouseInteraction={false} // not needed on /agenda
          fpsCap={60}              // desktop cap
        />
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
