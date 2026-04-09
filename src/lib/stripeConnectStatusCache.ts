'use client';

import type { StripeConnectStatus } from '@/types/stripeConnect';

export const STRIPE_CONNECT_STATUS_CACHE_TTL_MS = 120_000;

let __cachedStatus: StripeConnectStatus | undefined = undefined;
let __cachedAtMs = 0;
let __inflight: Promise<StripeConnectStatus | null> | null = null;

export function getCachedStripeConnectStatus(): StripeConnectStatus | undefined {
  return __cachedStatus;
}

export function getStripeConnectStatusCacheAgeMs(): number | null {
  if (!__cachedStatus) return null;
  return Math.max(0, Date.now() - __cachedAtMs);
}

export function isStripeConnectStatusCacheStale(
  maxAgeMs = STRIPE_CONNECT_STATUS_CACHE_TTL_MS
): boolean {
  if (!__cachedStatus) return true;
  const ageMs = getStripeConnectStatusCacheAgeMs();
  if (ageMs === null) return true;
  return ageMs > maxAgeMs;
}

export function getFreshStripeConnectStatus(
  maxAgeMs = STRIPE_CONNECT_STATUS_CACHE_TTL_MS
): StripeConnectStatus | undefined {
  return isStripeConnectStatusCacheStale(maxAgeMs) ? undefined : __cachedStatus;
}

export function setCachedStripeConnectStatus(status: StripeConnectStatus): void {
  __cachedStatus = status;
  __cachedAtMs = Date.now();
}

export function invalidateStripeConnectStatusCache(): void {
  __cachedStatus = undefined;
  __cachedAtMs = 0;
}

export function getStripeConnectStatusInflight(): Promise<StripeConnectStatus | null> | null {
  return __inflight;
}

export function setStripeConnectStatusInflight(
  promise: Promise<StripeConnectStatus | null> | null
): void {
  __inflight = promise;
}

export function clearStripeConnectStatusInflight(): void {
  __inflight = null;
}
