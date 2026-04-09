import { useEffect, type RefObject } from 'react';
import { toast } from 'sonner';

type NumberRef = RefObject<number | null>;

type UseCheckoutOpenFinalizerParams = {
  checkoutOpenedEventName: string;
  isPreparingCheckout: boolean;
  preparingCheckoutEventId: string | null;
  prepareTimeoutRef: NumberRef;
  paidIntroStartRef: NumberRef;
  paidFinalizeRef: NumberRef;
  paidToastMinMs: number;
  paidRedirectToastId: string;
  setIsPreparingCheckout: (value: boolean) => void;
  setPreparingCheckoutEventId: (value: string | null) => void;
  onOpenChange: (open: boolean) => void;
};

export default function useCheckoutOpenFinalizer({
  checkoutOpenedEventName,
  isPreparingCheckout,
  preparingCheckoutEventId,
  prepareTimeoutRef,
  paidIntroStartRef,
  paidFinalizeRef,
  paidToastMinMs,
  paidRedirectToastId,
  setIsPreparingCheckout,
  setPreparingCheckoutEventId,
  onOpenChange,
}: UseCheckoutOpenFinalizerParams): void {
  useEffect(() => {
    const finalize = () => {
      setIsPreparingCheckout(false);
      setPreparingCheckoutEventId(null);
      toast.dismiss(paidRedirectToastId);
      onOpenChange(false);
    };

    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ eventId?: string }>;
      const openedId = ce.detail?.eventId;
      if (!openedId) return;
      if (!isPreparingCheckout || preparingCheckoutEventId !== openedId) return;

      if (prepareTimeoutRef.current) window.clearTimeout(prepareTimeoutRef.current);
      prepareTimeoutRef.current = null;

      const start = paidIntroStartRef.current ?? performance.now();
      const elapsed = performance.now() - start;
      const remaining = Math.max(0, paidToastMinMs - elapsed);

      if (paidFinalizeRef.current) window.clearTimeout(paidFinalizeRef.current);
      paidFinalizeRef.current = window.setTimeout(() => {
        paidFinalizeRef.current = null;
        finalize();
      }, remaining);
    };

    window.addEventListener(checkoutOpenedEventName, handler);
    return () => window.removeEventListener(checkoutOpenedEventName, handler);
  }, [
    checkoutOpenedEventName,
    isPreparingCheckout,
    onOpenChange,
    paidFinalizeRef,
    paidIntroStartRef,
    paidRedirectToastId,
    paidToastMinMs,
    prepareTimeoutRef,
    preparingCheckoutEventId,
    setIsPreparingCheckout,
    setPreparingCheckoutEventId,
  ]);
}
