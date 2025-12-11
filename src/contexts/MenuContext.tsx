'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import type { EventWithCreatorAndRsvps, EditableEvent } from '@/types/event';
import type { UserProfileForAvatar } from '@/types/rsvp';
import { getCachedProfilePhone, primeProfilePhone } from '@/lib/profilePhoneCache';
import { getCachedViewerUser, primeViewerUser } from '@/lib/viewerUserCache';

// Lazy load: the chunk won't be included unless the menu is opened
const Menu = dynamic(() => import('@/components/Menu/Menu'), { ssr: false });

/** Menu modes */
type MenuVariant = 'non-editable' | 'editable';

/** Menu state: discriminated union aligned with <Menu />, centered on eventId */
type MenuPayload =
  | {
      mode: 'non-editable';
      eventId: string;
      /** Back-compat: still pass the object if the caller sent it (to be removed later) */
      event?: EventWithCreatorAndRsvps;
      onEventUpdate?: (e: EventWithCreatorAndRsvps) => void;
      onEventDeleted?: (id: string) => void;
      onRsvpCancelled?: (id: string) => void;
    }
  | {
      mode: 'editable';
      eventId: string;
      event?: EditableEvent; // temporary back-compat
      onEventUpdate?: (e: EventWithCreatorAndRsvps) => void;
      onEventDeleted?: (id: string) => void;
    };

type MenuCtxValue = {
  /** Overloads: id or event (back-compat). We don't break existing call sites. */
  open: {
    (eventId: string, opts?: {
      mode?: MenuVariant;
      onEventUpdate?: (e: EventWithCreatorAndRsvps) => void;
      onEventDeleted?: (id: string) => void;
      onRsvpCancelled?: (id: string) => void;
    }): void;
    (event: EditableEvent, opts?: {
      mode?: Extract<MenuVariant, 'editable'>;
      onEventUpdate?: (e: EventWithCreatorAndRsvps) => void;
      onEventDeleted?: (id: string) => void;
    }): void;
    (event: EventWithCreatorAndRsvps, opts?: {
      mode?: Extract<MenuVariant, 'non-editable'>;
      onEventUpdate?: (e: EventWithCreatorAndRsvps) => void;
      onEventDeleted?: (id: string) => void;
      onRsvpCancelled?: (id: string) => void;
    }): void;
  };
  close: () => void;
  prefetch: () => void;
  profilePhone: string | null | undefined;
  ensureProfilePhone: () => Promise<string | null>;
  /** isOpen for external consumers (based on whether there is a mounted payload) */
  isOpen: boolean;
};

const MenuCtx = createContext<MenuCtxValue | null>(null);

export function MenuContextProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<MenuPayload | null>(null);
  /** Controls the visual open state (Dialog/Drawer) to allow exit animations */
  const [isOpen, setIsOpen] = useState(false);
  // Keep a reactive copy of the cached value so consumers can update when the prime resolves.
  const [profilePhone, setProfilePhone] = useState<string | null | undefined>(() => getCachedProfilePhone());
  const [viewerUser, setViewerUser] = useState<UserProfileForAvatar | null | undefined>(() => getCachedViewerUser());
  const closeTimerRef = useRef<number | null>(null);
  const EXIT_MS = 200; // ⟵ keep in sync with Dialog/Drawer timing

  const safeClearTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  // Ensure the profile phone is loaded and update local state from the cache.
  const ensureProfilePhone = useCallback(async () => {
    const v = await primeProfilePhone();
    setProfilePhone(v);
    return v;
  }, []);

  const ensureViewerUser = useCallback(async () => {
    const v = await primeViewerUser();
    setViewerUser(v);
    return v;
  }, []);

  const close = useCallback(() => {
    // 0) Cancel any pending deferred-unmount timer
    safeClearTimer();
    // 1) Visually close (triggers data-state="closed" and runs the animation)
    setIsOpen(false);
    // 2) Unmount payload only after the exit animation completes
    closeTimerRef.current = window.setTimeout(() => {
      setPayload(null);
      closeTimerRef.current = null;
    }, EXIT_MS);
  }, [safeClearTimer]);

  const open = useCallback((
    eventOrId: string | EditableEvent | EventWithCreatorAndRsvps,
    opts?: {
      mode?: MenuVariant;
      onEventUpdate?: (e: EventWithCreatorAndRsvps) => void;
      onEventDeleted?: (id: string) => void;
      onRsvpCancelled?: (id: string) => void;
    }
  ) => {
    const mode: MenuVariant = opts?.mode ?? 'non-editable';
    const isId = typeof eventOrId === 'string';
    const eventId = isId ? eventOrId : eventOrId.id;

    // Cancel any pending close timer (e.g., if reopening very quickly)
    safeClearTimer();

    if (mode === 'editable') {
      setPayload({
        mode: 'editable',
        eventId,
        event: isId ? undefined : (eventOrId as EditableEvent), // temporary back-compat
        onEventUpdate: opts?.onEventUpdate,
        onEventDeleted: opts?.onEventDeleted,
      });
    } else {
      setPayload({
        mode: 'non-editable',
        eventId,
        event: isId ? undefined : (eventOrId as EventWithCreatorAndRsvps), // temporary back-compat
        onEventUpdate: opts?.onEventUpdate,
        onEventDeleted: opts?.onEventDeleted,
        onRsvpCancelled: opts?.onRsvpCancelled,
      });
    }

    // If editable, warm the cache BEFORE mounting the menu.
    if (mode === 'editable') {
       void ensureProfilePhone().catch(() => {}); // fire-and-forget
    }

    void ensureViewerUser().catch(() => {}); // fire-and-forget    

    setIsOpen(true);
  }, [safeClearTimer, ensureProfilePhone, ensureViewerUser]);

  const prefetch = useCallback(() => {
    void import('@/components/Menu/Menu');
     // Also warm the profile phone cache and user info for rsvps ahead of time.
     void ensureProfilePhone().catch(() => {});
    void ensureViewerUser().catch(() => {});
  }, [ensureProfilePhone, ensureViewerUser]);

  const ctx = useMemo<MenuCtxValue>(
    () => ({
      open: open as MenuCtxValue['open'],
      close,
      prefetch,
      profilePhone,
      ensureProfilePhone,
      // For external consumers, consider it "open" if we have a payload
      isOpen: payload != null,
    }),
    [open, close, prefetch, profilePhone, ensureProfilePhone, payload]
  );

  return (
    <MenuCtx.Provider value={ctx}>
      {children}
      {payload && (
        payload.mode === 'editable' ? (
          <Menu
            mode="editable"
            eventId={payload.eventId}
            {...(payload.event ? { event: payload.event } : {})} // EditableEvent
            viewerUser={viewerUser ?? null}
            open={isOpen}
            onOpenChange={(next) => {
              if (next) {
                safeClearTimer();
                setIsOpen(true);
              } else {
                close();
              }
            }}
            onEventUpdate={(e) => payload.onEventUpdate?.(e)}
            onEventDeleted={(id) => {
              payload.onEventDeleted?.(id);
              close();
            }}
          />
        ) : (
          <Menu
            mode="non-editable"
            eventId={payload.eventId}
            {...(payload.event ? { event: payload.event } : {})} // EventWithCreatorAndRsvps
            viewerUser={viewerUser ?? null}
            open={isOpen}
            onOpenChange={(next) => {
              if (next) {
                safeClearTimer();
                setIsOpen(true);
              } else {
                close();
              }
            }}
            onEventUpdate={(e) => payload.onEventUpdate?.(e)}
            onEventDeleted={(id) => {
              payload.onEventDeleted?.(id);
              close();
            }}
            onRsvpCancelled={payload.onRsvpCancelled}
          />
        )
      )}
    </MenuCtx.Provider>
  );
}

export function useMenu(): MenuCtxValue {
  const ctx = useContext(MenuCtx);
  if (!ctx) throw new Error('useMenu must be used within <MenuContextProvider>');
  return ctx;
}
