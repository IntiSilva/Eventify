import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getAdminSelectedUserWorkspaceStats } from '@/lib/data'
import type {
  AdminSelectedUserWorkspaceStatsResponse,
  ApiErrorResponse,
} from '@/types/api'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: requesterId, sessionClaims } = await auth()

    if (!requesterId) {
      const payload: ApiErrorResponse = {
        success: false,
        error: 'Unauthorized',
      }
      return NextResponse.json(payload, { status: 401 })
    }

    if (sessionClaims?.publicMetadata?.role !== 'admin') {
      const payload: ApiErrorResponse = {
        success: false,
        error: 'Forbidden',
      }
      return NextResponse.json(payload, { status: 403 })
    }

    const { userId } = await params
    const stats = await getAdminSelectedUserWorkspaceStats(userId)

    const payload: AdminSelectedUserWorkspaceStatsResponse = {
      success: true,
      data: stats,
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[API /admin/users/[userId]/workspace-stats] Error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'

    const payload: ApiErrorResponse = {
      success: false,
      error: `Failed to fetch selected-user workspace stats: ${message}`,
    }

    return NextResponse.json(payload, { status: 500 })
  }
}
