import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

import { listViewerTicketsForUser } from '@/lib/payments/viewerTickets.server';
import type { ApiErrorResponse, ViewerMyTicketsResponse } from '@/types/api';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Unauthorized',
      };
      return NextResponse.json(body, { status: 401, headers: NO_STORE_HEADERS });
    }

    const tickets = await listViewerTicketsForUser(userId);

    const body: ViewerMyTicketsResponse = {
      success: true,
      data: {
        tickets,
      },
    };

    return NextResponse.json(body, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('[API /payments/my-tickets] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    const body: ApiErrorResponse = {
      success: false,
      error: `Failed to load viewer tickets: ${message}`,
    };

    return NextResponse.json(body, { status: 500, headers: NO_STORE_HEADERS });
  }
}
