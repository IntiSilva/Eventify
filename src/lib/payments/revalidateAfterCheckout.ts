import type { Key } from 'swr';
import { revalidateEventLists, type GlobalMutate } from '@/lib/mutateHelpers';

export const CHECKOUT_REVALIDATE_SECOND_PASS_DELAY_MS = 850;

export const buildViewerPaymentStatusKey = (eventId: string, userId: string) =>
  ['/api/payments/viewer-status', eventId, userId] as const;

export const isConfirmedCountKey = (key: Key): boolean =>
  typeof key === 'string' && key.startsWith('/api/events/confirmed-count?ids=');

type RevalidateAfterCheckoutParams = {
  mutate: GlobalMutate;
  eventId: string;
  userId: string;
};

export async function revalidateViewerPaymentStatus({
  mutate,
  eventId,
  userId,
}: RevalidateAfterCheckoutParams): Promise<void> {
  await mutate(buildViewerPaymentStatusKey(eventId, userId));
}

export async function revalidateAfterCheckout({
  mutate,
  eventId,
  userId,
}: RevalidateAfterCheckoutParams): Promise<void> {
  await Promise.all([
    revalidateViewerPaymentStatus({ mutate, eventId, userId }),
    revalidateEventLists(mutate),
    mutate(isConfirmedCountKey),
  ]);
}

type ScheduleSecondPassRevalidateParams = RevalidateAfterCheckoutParams & {
  delayMs?: number;
};

export function scheduleSecondPassRevalidate({
  mutate,
  eventId,
  userId,
  delayMs = CHECKOUT_REVALIDATE_SECOND_PASS_DELAY_MS,
}: ScheduleSecondPassRevalidateParams): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void revalidateAfterCheckout({ mutate, eventId, userId });
  }, delayMs);
}
