import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeUsername, validateUsername } from '@/lib/utils';
import type { UsernameAvailabilityResponse, ApiErrorResponse } from '@/types/api';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get('u') || '').trim();
    const invalidMsg = validateUsername(raw);

    if (!raw || invalidMsg) {
      const payload: UsernameAvailabilityResponse = {
        success: true,
        data: {
          available: false,
          reason: invalidMsg ?? 'invalid',
        },
      };
      return NextResponse.json(payload);
    }

    const normalized = normalizeUsername(raw);
    const hit = await prisma.user.findUnique({
      where: { normalizedUsername: normalized },
      select: { id: true },
    });

    const payload: UsernameAvailabilityResponse = {
      success: true,
      data: {
        available: !hit,
      },
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[API /username-availability] Error:', err);
    const body: ApiErrorResponse = {
      success: false,
      error: 'Failed to check username availability',
    };
    return NextResponse.json(body, { status: 500 });
  }
}
