'use client';

import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn, formatPrice } from '@/lib/utils';
import type { ViewerPaymentStatusResponse } from '@/lib/payments/useViewerPaymentStatus';
import AnimatedIcon from '@/components/LordIcons/AnimatedIcon';
import { LoadingCirclesAnimatedIcon } from '@/lib/icons';

type PopoverSide = React.ComponentProps<typeof PopoverContent>['side'];
type PopoverAlign = React.ComponentProps<typeof PopoverContent>['align'];

type Props = {
  children: ReactNode;
  paymentStatus?: ViewerPaymentStatusResponse;
  isLoading?: boolean;
  isSignedIn?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onRequestRefund?: () => void;
  refundCtaState?: 'loading' | 'available' | 'unavailable';
  refundCtaLabel?: string;
  refundBlockedMessage?: string | null;
  side?: PopoverSide;
  align?: PopoverAlign;
  sideOffset?: number;
  contentClassName?: string;
  portalled?: boolean;
};


export default function PaidTicketInfoPopover({
  children,
  paymentStatus,
  isLoading = false,
  isSignedIn = false,
  open,
  onOpenChange,
  onRequestRefund,
  refundCtaState,
  refundCtaLabel = 'Request a refund',
  refundBlockedMessage = null,
  side = 'top',
  align = 'end',
  sideOffset = 6,
  contentClassName,
  portalled = true,
}: Props) {
  const ticketState = paymentStatus?.ticketState ?? 'none';
  const isPaymentStatusLoading = isLoading && !paymentStatus;
  const showLoadingRefundCta = isSignedIn && refundCtaState === 'loading';
  const showAvailableRefundCta = isSignedIn && refundCtaState === 'available';
  const showUnavailableRefundCta =
    isSignedIn &&
    refundCtaState === 'unavailable' &&
    ticketState === 'paid' &&
    Boolean(refundBlockedMessage);
  const showRefundCtaSection =
    showLoadingRefundCta || showAvailableRefundCta || showUnavailableRefundCta;
  const refundCtaBaseClassName =
    'h-8 rounded-[0.7rem] border px-3.5 text-[11px] font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-offset-0';
  const refundCtaAmberClassName =
    'border-amber-700/70 bg-amber-950/35 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.09),0_8px_20px_rgba(120,53,15,0.3)] hover:border-amber-500/70 hover:bg-amber-900/40 hover:text-amber-50 focus-visible:ring-amber-600/35';
  const refundCtaMutedClassName =
    'border-amber-900/60 bg-amber-950/20 text-amber-200/60 disabled:opacity-100';

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>

      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        portalled={portalled}
        className={
          contentClassName ??
          'w-auto min-w-0 max-w-[min(16.5rem,calc(100vw-1rem))] rounded-xl border border-zinc-800 bg-black p-3 text-zinc-200 shadow-2xl'
        }
      >
        <div className="space-y-1">
          {isPaymentStatusLoading ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-zinc-300">Loading payment details</p>
              <AnimatedIcon icon={LoadingCirclesAnimatedIcon} size={14} state="loop" />
            </div>
          ) : paymentStatus?.payment ? (
            <>
              {ticketState === 'refunded' ? (
                <p className="text-sm font-medium text-zinc-100">
                  Refunded{' '}
                  <span className="text-zinc-200">
                    {formatPrice(paymentStatus.payment.amountCents, paymentStatus.payment.currency) ||
                      '\u2014'}
                  </span>
                </p>
              ) : ticketState === 'refund_pending' ? (
                <p className="text-sm font-medium text-zinc-100">
                  Paid{' '}
                  <span className="text-amber-300">
                    {formatPrice(paymentStatus.payment.amountCents, paymentStatus.payment.currency) ||
                      '\u2014'}
                  </span>
                </p>
              ) : (
                <p className="text-sm font-medium text-zinc-100">
                  Paid{' '}
                  <span className="text-emerald-300">
                    {formatPrice(paymentStatus.payment.amountCents, paymentStatus.payment.currency) ||
                      '\u2014'}
                  </span>
                </p>
              )}

              {paymentStatus.payment.paidAt && (
                <p className="text-[11px] text-zinc-400">
                  Paid at {new Date(paymentStatus.payment.paidAt).toLocaleString()}
                </p>
              )}

              {ticketState === 'refund_pending' ? (
                <p className="text-[11px] text-amber-400">Refund in progress.</p>
              ) : null}

              {ticketState === 'refunded' ? (
                <p className="text-[11px] text-zinc-400">This purchase was fully refunded.</p>
              ) : null}

              {process.env.NODE_ENV !== 'production' && paymentStatus.payment.payoutTarget ? (
                <div className="mt-1 rounded-md border border-zinc-800/80 bg-zinc-950/70 px-2 py-1 text-[10px] text-zinc-400">
                  <p>
                    Debug payout:{' '}
                    <span className="text-zinc-200">{paymentStatus.payment.payoutTarget}</span>
                  </p>

                  {paymentStatus.payment.payoutTarget === 'organizer' &&
                  paymentStatus.payment.destinationAccountId ? (
                    <p className="break-all">
                      Destination:{' '}
                      <span className="text-zinc-200">
                        {paymentStatus.payment.destinationAccountId}
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : isSignedIn ? (
            <>
              <p className="text-sm text-zinc-200">Ticketed event</p>
              <p className="text-[11px] text-zinc-400">No payment found for this account.</p>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-200">Ticketed event</p>
              <p className="text-[11px] text-zinc-400">Sign in to view payment details.</p>
            </>
          )}
        </div>

        {showRefundCtaSection ? (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            {showLoadingRefundCta ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  size="sm"
                  disabled
                  className={cn(
                    refundCtaBaseClassName,
                    'border-amber-900/70 bg-amber-950/20 text-amber-200/70 shadow-[0_0_0_1px_rgba(251,191,36,0.06)] disabled:opacity-100'
                  )}
                >
                  Checking purchase...
                </Button>
              </div>
            ) : showAvailableRefundCta ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  size="sm"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRequestRefund?.();
                  }}
                  className={cn(
                    refundCtaBaseClassName,
                    refundCtaAmberClassName,
                    'active:scale-[0.99]'
                  )}
                >
                  {refundCtaLabel}
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex justify-center">
                  <Button
                    type="button"
                    size="sm"
                    disabled
                    className={cn(refundCtaBaseClassName, refundCtaMutedClassName)}
                  >
                    {refundCtaLabel}
                  </Button>
                </div>

                <p className="max-w-[15rem] text-[11px] leading-relaxed text-zinc-500">
                  {refundBlockedMessage}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
