'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { useMediaQuery } from '@/lib/hooks';
import { useViewerTickets } from '@/lib/payments/useViewerTickets';
import { cn } from '@/lib/utils';
import MyTicketsList from './MyTicketsList';
import MyTicketDetails from './MyTicketDetails';
import MyTicketsRailHeader from './MyTicketsRailHeader';
import { groupViewerTicketsByEventTime } from './ticketGrouping';

type MyTicketsRailProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openableEventIds: ReadonlySet<string>;
  onViewEvent?: (eventId: string) => void;
};

const RAIL_SCROLLBAR_CLASSES = cn(
  '[&::-webkit-scrollbar]:w-1',
  '[&::-webkit-scrollbar-track]:bg-transparent',
  '[&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:bg-emerald-900',
  '[&::-webkit-scrollbar-thumb:hover]:bg-emerald-600',
  '[&::-webkit-scrollbar-thumb:hover]:cursor-pointer'
);

export default function MyTicketsRail({
  open,
  onOpenChange,
  openableEventIds,
  onViewEvent,
}: MyTicketsRailProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);

  useEffect(() => {
    if (open && !hasOpenedOnce) {
      const latchOpen = () => setHasOpenedOnce(true);
      if (typeof queueMicrotask === 'function') queueMicrotask(latchOpen);
      else Promise.resolve().then(latchOpen);
    }
  }, [open, hasOpenedOnce]);

  const { tickets, isLoading, isValidating, error, mutate } = useViewerTickets(open || hasOpenedOnce);
  const grouped = useMemo(() => groupViewerTicketsByEventTime(tickets), [tickets]);
  const selectedTicket = useMemo(
    () => (selectedPaymentId ? tickets.find((ticket) => ticket.paymentId === selectedPaymentId) ?? null : null),
    [selectedPaymentId, tickets]
  );
  const drawerDirection: 'right' | 'bottom' = isDesktop ? 'right' : 'bottom';
  const showInitialLoading = isLoading && tickets.length === 0;
  const listDetailsTransition = {
    duration: 0.2,
    ease: 'easeOut' as const,
  };

  useEffect(() => {
    if (selectedPaymentId && !selectedTicket) {
      let cancelled = false;
      const resetSelection = () => {
        if (cancelled) return;
        setSelectedPaymentId(null);
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(resetSelection);
      else Promise.resolve().then(resetSelection);
      return () => {
        cancelled = true;
      };
    }
  }, [selectedPaymentId, selectedTicket]);

  useEffect(() => {
    if (!open && selectedPaymentId) {
      let cancelled = false;
      const resetSelection = () => {
        if (cancelled) return;
        setSelectedPaymentId(null);
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(resetSelection);
      else Promise.resolve().then(resetSelection);
      return () => {
        cancelled = true;
      };
    }
  }, [open, selectedPaymentId]);

  const handleRailOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedPaymentId(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Drawer open={open} onOpenChange={handleRailOpenChange} direction={drawerDirection}>
      <DrawerContent
        className={cn(
          'overflow-hidden border-white/10 bg-black/95 p-0 text-white',
          'data-[vaul-drawer-direction=right]:h-[100dvh] data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:max-w-[min(30rem,calc(100vw-1rem))] data-[vaul-drawer-direction=right]:sm:max-w-[30rem]',
          'data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:min-h-[100dvh]'
        )}
      >
        <div className="flex h-full min-h-0 flex-col">
          <MyTicketsRailHeader
            count={tickets.length}
            loading={showInitialLoading || (isValidating && tickets.length === 0)}
          />

          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4 md:px-5',
              '[-webkit-overflow-scrolling:touch]',
              RAIL_SCROLLBAR_CLASSES
            )}
          >
            {showInitialLoading ? (
              <div aria-live="polite" aria-busy="true">
                <MyTicketsList
                  upcoming={grouped.upcoming}
                  past={grouped.past}
                  openableEventIds={openableEventIds}
                  onViewTicket={(paymentId) => setSelectedPaymentId(paymentId)}
                  onViewEvent={onViewEvent}
                  loading
                />
              </div>
            ) : error ? (
              <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 text-sm text-rose-200">
                <p>Couldn&apos;t load your tickets right now.</p>
                <button
                  type="button"
                  onClick={() => void mutate()}
                  className="mt-3 inline-flex h-8 items-center rounded-full border border-rose-700/70 bg-rose-900/35 px-3 text-xs text-rose-100 transition-colors hover:bg-rose-900/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600/60"
                >
                  Try again
                </button>
              </div>
            ) : tickets.length === 0 ? (
              <div className="rounded-xl border border-zinc-800/90 bg-black/35 p-4 text-sm text-zinc-400">
                You don&apos;t have ticket purchases yet.
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                {selectedTicket ? (
                  <motion.div
                    key="ticket-details"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 16 }}
                    transition={listDetailsTransition}
                  >
                    <MyTicketDetails
                      ticket={selectedTicket}
                      isEventOpenable={openableEventIds.has(selectedTicket.event.id)}
                      onBack={() => setSelectedPaymentId(null)}
                      onViewEvent={onViewEvent}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="tickets-list"
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={listDetailsTransition}
                  >
                    <MyTicketsList
                      upcoming={grouped.upcoming}
                      past={grouped.past}
                      openableEventIds={openableEventIds}
                      onViewTicket={(paymentId) => setSelectedPaymentId(paymentId)}
                      onViewEvent={onViewEvent}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
