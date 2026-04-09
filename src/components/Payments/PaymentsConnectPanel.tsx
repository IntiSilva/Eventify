'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  getConnectStatus,
  refreshConnectStatus,
  startConnectOnboarding,
} from '@/app/(dashboard)/organizer/actions';
import type { StripeConnectStatus } from '@/types/stripeConnect';
import {
  clearStripeConnectStatusInflight,
  getFreshStripeConnectStatus,
  getStripeConnectStatusInflight,
  setCachedStripeConnectStatus,
  setStripeConnectStatusInflight,
} from '@/lib/stripeConnectStatusCache';

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function renderBoolean(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function ValueSkeleton({ width = 'w-40' }: { width?: string }) {
  return <div className={`h-4 rounded bg-zinc-800/80 animate-pulse ${width}`} />;
}

export default function PaymentsConnectPanel() {
  const initialCachedStatus = getFreshStripeConnectStatus();
  const [status, setStatus] = useState<StripeConnectStatus | null>(initialCachedStatus ?? null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(!initialCachedStatus);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;

    const cachedStatus = getFreshStripeConnectStatus();
    if (cachedStatus) {
      setStatus(cachedStatus);
      setIsLoadingStatus(false);
      return () => {
        active = false;
      };
    }

    const existingInflight = getStripeConnectStatusInflight();
    const request =
      existingInflight ??
      (async () => {
        try {
          const result = await getConnectStatus();
          if (result.status) {
            setCachedStripeConnectStatus(result.status);
            return result.status;
          }
          return null;
        } finally {
          clearStripeConnectStatusInflight();
        }
      })();

    if (!existingInflight) {
      setStripeConnectStatusInflight(request);
    }

    void (async () => {
      setIsLoadingStatus(true);
      try {
        const nextStatus = await request;
        if (!active) return;
        if (nextStatus) {
          setStatus(nextStatus);
        }
      } catch {
        if (!active) return;
      }
      setIsLoadingStatus(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const handleRefresh = () => {
    startTransition(() => {
      void (async () => {
        const result = await refreshConnectStatus();
        if (!result.success) {
          if (result.status) {
            setStatus(result.status);
            setCachedStripeConnectStatus(result.status);
          }
          toast.error(result.error);
          return;
        }
        setStatus(result.status);
        setCachedStripeConnectStatus(result.status);
        toast.success('Stripe Connect status refreshed.');
      })();
    });
  };

  const handleConnect = () => {
    startTransition(() => {
      void (async () => {
        const result = await startConnectOnboarding();
        if (!result.success) {
          if (result.status) {
            setStatus(result.status);
            setCachedStripeConnectStatus(result.status);
          }
          toast.error(result.error);
          return;
        }
        setStatus(result.status);
        setCachedStripeConnectStatus(result.status);
        window.location.assign(result.url);
      })();
    });
  };

  const canConnect = !status?.payoutsEnabled;
  const isBusy = isPending || isLoadingStatus;
  const showInitialSkeleton = isLoadingStatus && !status;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-bold">Stripe Connect</h2>
        <p className="text-sm text-zinc-400">
          Connect your payouts account to receive ticket revenue.
        </p>
      </div>

      <div className="space-y-4 border-t border-white/[0.07] pt-4">
        <dl className="grid grid-cols-[140px_1fr] items-center gap-y-2 text-sm">
          <dt className="text-zinc-400">Account ID</dt>
          <dd>
            {showInitialSkeleton ? (
              <ValueSkeleton width="w-44" />
            ) : (
              status?.accountId ?? 'Not connected'
            )}
          </dd>

          <dt className="text-zinc-400">Charges enabled</dt>
          <dd>
            {showInitialSkeleton ? (
              <ValueSkeleton width="w-12" />
            ) : (
              renderBoolean(Boolean(status?.chargesEnabled))
            )}
          </dd>

          <dt className="text-zinc-400">Payouts enabled</dt>
          <dd>
            {showInitialSkeleton ? (
              <ValueSkeleton width="w-12" />
            ) : (
              renderBoolean(Boolean(status?.payoutsEnabled))
            )}
          </dd>

          <dt className="text-zinc-400">Details submitted</dt>
          <dd>
            {showInitialSkeleton ? (
              <ValueSkeleton width="w-12" />
            ) : (
              renderBoolean(Boolean(status?.detailsSubmitted))
            )}
          </dd>

          <dt className="text-zinc-400">Last updated</dt>
          <dd>
            {showInitialSkeleton ? (
              <ValueSkeleton width="w-36" />
            ) : (
              formatDateTime(status?.statusUpdatedAt ?? null)
            )}
          </dd>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isBusy}
            className="rounded-md border border-zinc-500/60 bg-zinc-700/20 px-3 py-1 text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          >
            Refresh status
          </button>

          {!showInitialSkeleton && canConnect && (
            <button
              type="button"
              onClick={handleConnect}
              disabled={isBusy}
              className="rounded-md border border-emerald-500/50 bg-emerald-600/20 px-3 py-1 text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            >
              Connect Stripe
            </button>
          )}
        </div>
      </div>
    </div>
  );
}