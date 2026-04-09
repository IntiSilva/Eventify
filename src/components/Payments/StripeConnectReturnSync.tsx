'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { refreshConnectStatus } from '@/app/(dashboard)/organizer/actions';
import { setCachedStripeConnectStatus } from '@/lib/stripeConnectStatusCache';

type StripeConnectReturnSyncProps = {
  enabled: boolean;
};

export default function StripeConnectReturnSync({
  enabled,
}: StripeConnectReturnSyncProps) {
  const router = useRouter();
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    if (!enabled || hasTriggeredRef.current) return;

    hasTriggeredRef.current = true;
    let active = true;

    void (async () => {
      try {
        const result = await refreshConnectStatus();
        if (result.status) {
          setCachedStripeConnectStatus(result.status);
        }
      } finally {
        if (active) {
          router.replace('/organizer');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [enabled, router]);

  return null;
}
