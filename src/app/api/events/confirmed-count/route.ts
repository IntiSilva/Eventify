import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { EventsConfirmedCountResponse } from '@/types/api';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get('ids') ?? '';
    const ids = raw.split(',').map(s => s.trim()).filter(Boolean);

    //If there's no ids, we return success true and empty array
    if (!ids.length) {
      const empty: EventsConfirmedCountResponse = { success: true, data: {} };
      return NextResponse.json(empty);
    }

    const rows = await prisma.rSVP.groupBy({
      by: ['eventId'],
      where: { eventId: { in: ids }, status: 'confirmed' },
      _count: { _all: true },
    });

    const map: Record<string, number> = {};
    for (const id of ids) map[id] = 0;
    for (const r of rows) map[r.eventId] = r._count._all;

    const ok: EventsConfirmedCountResponse = { success: true, data: map };
    return NextResponse.json(ok);
  } catch (err) {
    const fail: EventsConfirmedCountResponse = {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
    return NextResponse.json(fail, { status: 500 });
  }
}
