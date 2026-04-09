import { AnimatePresence, motion } from 'motion/react';
import type {
  TicketHistoryPillLabel,
  ViewerPaymentStatusResponse,
} from '@/lib/payments/useViewerPaymentStatus';
import { cn, formatPrice } from '@/lib/utils';
import PaidTicketInfoPopover from '../../Payments/PaidTicketInfoPopover';

type MenuTicketRowProps = {
  isPaid: boolean;
  priceCents?: number | null;
  currency?: string | null;
  paidPopoverOpen: boolean;
  onPaidPopoverOpenChange: (open: boolean) => void;
  onRequestRefund?: () => void;
  refundCtaState: 'loading' | 'available' | 'unavailable';
  refundBlockedMessage: string | null;
  paymentStatus?: ViewerPaymentStatusResponse;
  isPaymentStatusLoading: boolean;
  isSignedIn: boolean;
  shouldShowTicketHistoryPill: boolean;
  paidTriggerLabel: TicketHistoryPillLabel | null;
  paidTriggerAriaLabel: string;
  isRefundedTicketHistory: boolean;
};

export default function MenuTicketRow({
  isPaid,
  priceCents,
  currency,
  paidPopoverOpen,
  onPaidPopoverOpenChange,
  onRequestRefund,
  refundCtaState,
  refundBlockedMessage,
  paymentStatus,
  isPaymentStatusLoading,
  isSignedIn,
  shouldShowTicketHistoryPill,
  paidTriggerLabel,
  paidTriggerAriaLabel,
  isRefundedTicketHistory,
}: MenuTicketRowProps) {
  if (!isPaid) return null;

  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <div className="flex items-center justify-between gap-3 text-sm text-zinc-200">
        <p className="font-semibold shrink-0">Ticket</p>

        <div className="flex items-center gap-2 min-w-0">
          <AnimatePresence initial={false}>
            {shouldShowTicketHistoryPill && paidTriggerLabel ? (
              <motion.span
                key={`ticket-history-${paidTriggerLabel}`}
                initial={{ opacity: 0, y: 3, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 2, scale: 0.98 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="inline-flex shrink-0"
              >
                <PaidTicketInfoPopover
                  open={paidPopoverOpen}
                  onOpenChange={onPaidPopoverOpenChange}
                  onRequestRefund={onRequestRefund}
                  refundCtaState={refundCtaState}
                  refundBlockedMessage={refundBlockedMessage}
                  paymentStatus={paymentStatus}
                  isLoading={isPaymentStatusLoading}
                  isSignedIn={isSignedIn}
                  side="top"
                  align="end"
                  sideOffset={6}
                  portalled={false}
                >
                  <button
                    type="button"
                    aria-label={paidTriggerAriaLabel}
                    className={cn(
                      'inline-flex h-5 shrink-0 items-center rounded-full',
                      'px-2 py-0 text-[11px] leading-none font-medium cursor-pointer',
                      'transition-colors duration-200',
                      'xs4:active:scale-[0.98]',
                      'focus-visible:outline-none focus-visible:ring-2',
                      isRefundedTicketHistory
                        ? 'border border-amber-800/70 bg-amber-950/40 text-amber-300 xs4:hover:bg-amber-950/60 xs4:hover:border-amber-700/80 xs4:hover:text-amber-200 focus-visible:ring-amber-700/60'
                        : 'border border-emerald-800/70 bg-emerald-950/40 text-emerald-400 xs4:hover:bg-emerald-950/60 xs4:hover:border-emerald-700/80 xs4:hover:text-emerald-300 focus-visible:ring-emerald-700/60'
                    )}
                  >
                    <span className="inline-flex items-center leading-none">{paidTriggerLabel}</span>
                    <span
                      aria-hidden="true"
                      className="ml-1 inline-block xs4:hidden text-[10px] leading-none opacity-80"
                    >
                      ⓘ
                    </span>
                  </button>
                </PaidTicketInfoPopover>
              </motion.span>
            ) : null}
          </AnimatePresence>

          <p className="shrink-0 font-medium text-zinc-100">
            {formatPrice(priceCents ?? null, currency ?? undefined) || '\u2014'}
          </p>
        </div>
      </div>
    </div>
  );
}
