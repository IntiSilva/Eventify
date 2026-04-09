'use client';

import { useUser } from '@clerk/nextjs';
import useSWR from 'swr';

import { swrKeys } from '@/lib/swrKeys';
import type { ViewerMyTicketsResponse, ViewerTicketsPayload } from '@/types/api';

type ViewerTicketsFetchKey = readonly [string, string];

const fetchViewerTickets = async ([url]: ViewerTicketsFetchKey): Promise<ViewerTicketsPayload> => {
  const res = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
  });

  const json = (await res.json()) as ViewerMyTicketsResponse;

  if (!res.ok || !json.success) {
    const message = !json.success ? json.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return json.data;
};

export function useViewerTickets(enabled: boolean) {
  const { user } = useUser();
  const userId = user?.id ?? null;

  const swr = useSWR<ViewerTicketsPayload>(
    enabled && userId ? ([swrKeys.payments.myTickets(), userId] as const) : null,
    fetchViewerTickets,
    {
      revalidateOnMount: true,
      revalidateIfStale: true,
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    }
  );

  return {
    ...swr,
    tickets: swr.data?.tickets ?? [],
    userId,
    isSignedIn: Boolean(userId),
  };
}
