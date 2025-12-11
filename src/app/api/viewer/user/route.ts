import { NextResponse } from 'next/server';
import { getCurrentUserPublic } from '@/lib/viewer';
import type { UserProfileForAvatar } from '@/types/rsvp';

export async function GET() {
  try {
    const user: UserProfileForAvatar | null = await getCurrentUserPublic();
    return NextResponse.json(user, {
      headers: { 'Cache-Control': 'no-store, must-revalidate' },
    });
  } catch (e) {
    console.error('[GET /api/viewer/user] failed:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
