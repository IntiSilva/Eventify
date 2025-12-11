'use client';
import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { canonicalizeTimeZone, isValidIanaTimeZone, tzEqualForInstant } from '@/lib/utils';

type ViewerTzCtx = {
  viewerTz: string;
  setViewerTz: (tz: string) => void;
  formatDate: (
    iso: string | Date,
    tzOverride?: string,
    opts?: {
      showYear?: boolean;
      weekday?: 'short' | 'long' | 'narrow' | 'none';
      month?: 'short' | 'long' | 'numeric' | '2-digit';
      hour12?: boolean;
      locale?: string;
    }
  ) => string;
};

// Ensure a valid IANA TZ; fallback to 'UTC'
function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  const canon = canonicalizeTimeZone(tz);
  return isValidIanaTimeZone(canon) ? canon : 'UTC';
}

const Ctx = createContext<ViewerTzCtx | null>(null);
export const useViewerTz = (): ViewerTzCtx => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useViewerTz must be used inside a <ViewerTzProvider>');
  return ctx;
};

export const ViewerTzProvider: React.FC<{
  children: React.ReactNode;
  /** Seed provided by the server reading cookies().get('viewerTz') */
  initialViewerTz?: string;
}> = ({ children, initialViewerTz }) => {
  // 1) Start aligned with SSR (canonical cookie) to avoid hydration mismatches
  const ssrSeed = safeTimeZone(initialViewerTz ?? 'UTC');
  const [viewerTz, _setViewerTz] = useState<string>(() => ssrSeed);

  // Public setter (future-proof if you add a selector later)
  const setViewerTz = (tz: string) => _setViewerTz(safeTimeZone(tz));

  // On mount: detect client TZ and, if it differs from the SSR seed, update state
  useEffect(() => {
    let detected = 'UTC';
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {}
    const next = safeTimeZone(detected);

    // Compare against the SSR seed, not current state to avoid flicker/hydration issues
    if (!tzEqualForInstant(ssrSeed, next, new Date())) {
      const id = requestAnimationFrame(() => _setViewerTz(next));
      return () => cancelAnimationFrame(id);
    }
  }, [ssrSeed]);


  // Persist cookie IF viewerTz changes
  useEffect(() => {
    try {
      const prev = decodeURIComponent(
        document.cookie.match(/(?:^|; )viewerTz=([^;]+)/)?.[1] ?? ''
      );
      if (prev !== viewerTz) {
        const maxAge = 60 * 60 * 24 * 180; // 180 days
        document.cookie = `viewerTz=${encodeURIComponent(
          viewerTz
        )}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
      }
    } catch {}
  }, [viewerTz]);

  const formatDate = useMemo(
    () =>
      (
        d: string | Date,
        tzOverride?: string,
        opts?: {
          showYear?: boolean;
          weekday?: 'short' | 'long' | 'narrow' | 'none';
          month?: 'short' | 'long' | 'numeric' | '2-digit';
          hour12?: boolean;
          locale?: string;
        }
      ) => {
        const date = new Date(d);
        const timeZone = safeTimeZone(tzOverride ?? viewerTz);
        if (!opts) {
          return date.toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone,
          });
        }
        const {
          showYear = true,
          weekday = 'short',
          month = 'short',
          hour12,
          locale = 'en-US',
        } = opts;
        return date.toLocaleString(locale, {
          weekday: weekday === 'none' ? undefined : weekday,
          month,
          day: 'numeric',
          year: showYear ? 'numeric' : undefined,
          hour: 'numeric',
          minute: '2-digit',
          ...(hour12 !== undefined ? { hour12 } : {}),
          timeZone,
        });
      },
    [viewerTz]
  );

  return (
    <Ctx.Provider value={{ viewerTz, setViewerTz, formatDate }}>
      {children}
    </Ctx.Provider>
  );
};
