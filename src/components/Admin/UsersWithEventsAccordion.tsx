'use client';

import { useMemo, useState, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import type { RolesForEvents } from '@/types/event';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '../ui/accordion';
import UserEventsPanel from './UsersEventsPanel';

/**
 * Shape used by the admin page to render one accordion section per user.
 * - `role` is limited to the roles that can manage events in the admin area.
 * - `_count.createdEvents` is displayed in the trigger for quick context.
 */
type UserForAccordion = {
  clerkId: string;
  username: string;
  role: RolesForEvents;             // 'admin' | 'organizer'
  _count: { createdEvents: number } // used to show "X events"
};

interface UsersWithEventsAccordionProps {
  usersWithEvents: UserForAccordion[];
}

/**
 * Admin: Users + their events in an accordion (max 3 sections open at once).
 *
 * Details:
 * - Keeps the signed-in user first in the list.
 * - Controlled accordion with `type="multiple"` and a 3-item open cap.
 * - When opening a 4th section, the oldest-opened section is closed (FIFO).
 */
export default function UsersWithEventsAccordion({
  usersWithEvents,
}: UsersWithEventsAccordionProps) {
  const { user: clerkUser } = useUser();
  const currentClerkId = clerkUser?.id ?? null;

  /**
   * Keep the signed-in user first (stable across renders).
   * If the signed-in user is not present in the provided list, preserve the order.
   */
  const orderedUsers = useMemo(() => {
    if (!currentClerkId) return usersWithEvents;
    const arr = [...usersWithEvents];
    arr.sort((a, b) => {
      if (a.clerkId === currentClerkId) return -1;
      if (b.clerkId === currentClerkId) return 1;
      return 0;
    });
    return arr;
  }, [usersWithEvents, currentClerkId]);

  /** Controlled open values for the Accordion (max length = 3). */
  const [openValues, setOpenValues] = useState<string[]>([]);
  const prevOpenRef = useRef<string[]>(openValues);
  // Refs por usuario para scrollear su acordeón
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  const NAVBAR_COLLAPSED_HEIGHT = 52; // Navbar height
  const scrollToUserTop = (clerkId: string) => {
    const el = itemRefs.current[clerkId];
    if (!el) return;
    const prefersReduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const y = el.getBoundingClientRect().top + (window.scrollY || 0) - NAVBAR_COLLAPSED_HEIGHT;
    window.scrollTo({ top: Math.max(0, y), behavior: prefersReduced ? 'auto' : 'smooth' });
  };

  const handleOpenChange = (nextValues: string[]) => {
    // Identify which value was just toggled on (added)
    const prev = prevOpenRef.current;
    const added = nextValues.find((v) => !prev.includes(v));

    // If closing items (length shrank or equal without added), accept as-is
    if (!added) {
      prevOpenRef.current = nextValues;
      setOpenValues(nextValues);
      return;
    }

    // If within the cap, accept as-is
    if (nextValues.length <= 3) {
      prevOpenRef.current = nextValues;
      setOpenValues(nextValues);
      return;
    }

    // Over the cap (4th opened): close the oldest and keep the newest
    // Compose using previous order + the newly added item
    const pruned = [...prev, added].slice(-3);
    prevOpenRef.current = pruned;
    setOpenValues(pruned);
  };

  return (
    <Accordion
      type="multiple"
      value={openValues}
      onValueChange={handleOpenChange}
      className="space-y-2"
    >
      {orderedUsers.map((user) => {
        const isYou = currentClerkId && user.clerkId === currentClerkId;
        const roleLabel = user.role === 'admin' ? 'Admin' : 'Organizer';
        const decoratedRole = isYou ? 'You' : roleLabel;

        return (
          <AccordionItem
            key={user.clerkId}
            value={user.clerkId}
            className="border-zinc-800 "   // offset bajo header sticky (ajustá 24 a tu layout)
            ref={(el) => { itemRefs.current[user.clerkId] = el; }}
          >
            {/* Header: username + (role) + events count */}
            <AccordionTrigger className="font-semibold cursor-pointer hover:bg-zinc-800 px-4 rounded-t-lg">
              {/* Baseline alignment across mixed font sizes */}
              <span className="inline-flex items-baseline gap-2 leading-none">
                <span className="leading-none">{user.username}</span>
                <span className="text-zinc-400 text-xs leading-none">
                  ({decoratedRole})
                </span>
                <span aria-hidden className="text-zinc-500 leading-none">
                  — {user._count.createdEvents} events
                </span>
                <span className="sr-only">
                  {user._count.createdEvents} events
                </span>
              </span>
            </AccordionTrigger>

            {/* Body: user-specific events panel (client paginated via EventsContext) */}
            <AccordionContent>
              <UserEventsPanel
              userId={user.clerkId}
              onPageNav={() => {
                scrollToUserTop(user.clerkId);
              }}
            />
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
