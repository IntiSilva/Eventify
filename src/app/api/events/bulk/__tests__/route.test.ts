import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getEventsWithDetails: vi.fn(),
  prisma: {
    event: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/data', () => ({ getEventsWithDetails: h.getEventsWithDetails }))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))

import { POST } from '@/app/api/events/bulk/route'

function makeRequest(body: unknown): Request {
  return new Request('https://example.test/api/events/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function jsonOf(res: Response) {
  return {
    status: res.status,
    body: await res.json(),
  }
}

describe('POST /api/events/bulk', () => {
  beforeEach(() => {
    h.auth.mockReset()
    h.getEventsWithDetails.mockReset()
    h.prisma.event.findMany.mockReset()
    h.auth.mockResolvedValue({ userId: 'clerk_user_1' })
  })

  it('returns 401 when unauthenticated and does not hit query layer', async () => {
    h.auth.mockResolvedValueOnce({ userId: null })

    const res = await POST(
      makeRequest({
        ids: ['evt_1'],
        rsvpStatus: 'confirmed',
      }),
    )
    const { status, body } = await jsonOf(res)

    expect(status).toBe(401)
    expect(body).toEqual({
      success: false,
      error: 'Unauthorized',
    })
    expect(h.getEventsWithDetails).not.toHaveBeenCalled()
    expect(h.prisma.event.findMany).not.toHaveBeenCalled()
  })

  it('returns 400 when rsvpStatus is missing and does not hit query layer', async () => {
    const res = await POST(
      makeRequest({
        ids: ['evt_1'],
      }),
    )
    const { status, body } = await jsonOf(res)

    expect(status).toBe(400)
    expect(body).toEqual({
      success: false,
      error: 'Missing rsvpStatus',
    })
    expect(h.getEventsWithDetails).not.toHaveBeenCalled()
    expect(h.prisma.event.findMany).not.toHaveBeenCalled()
  })

  it('returns 400 when rsvpStatus is invalid and does not hit query layer', async () => {
    const res = await POST(
      makeRequest({
        ids: ['evt_1'],
        rsvpStatus: 'invalid_status',
      }),
    )
    const { status, body } = await jsonOf(res)

    expect(status).toBe(400)
    expect(body).toEqual({
      success: false,
      error: 'Invalid rsvpStatus',
    })
    expect(h.getEventsWithDetails).not.toHaveBeenCalled()
    expect(h.prisma.event.findMany).not.toHaveBeenCalled()
  })

  it('keeps confirmed behavior for authenticated callers', async () => {
    h.getEventsWithDetails.mockResolvedValueOnce([])

    const res = await POST(
      makeRequest({
        ids: ['evt_1'],
        rsvpStatus: 'confirmed',
      }),
    )
    const { status, body } = await jsonOf(res)

    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: [],
    })
    expect(h.getEventsWithDetails).toHaveBeenCalledTimes(1)
    expect(h.prisma.event.findMany).not.toHaveBeenCalled()
  })
})
