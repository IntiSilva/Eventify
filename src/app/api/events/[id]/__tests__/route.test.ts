import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getEventWithRsvps: vi.fn(),
  getEventsWithDetails: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/data', () => ({
  getEventWithRsvps: h.getEventWithRsvps,
  getEventsWithDetails: h.getEventsWithDetails,
}))

import { GET } from '@/app/api/events/[id]/route'

function makeRequest(path: string): Request {
  return new Request(`https://example.test${path}`, { method: 'GET' })
}

async function jsonOf(res: Response) {
  return {
    status: res.status,
    body: await res.json(),
  }
}

describe('GET /api/events/[id]', () => {
  beforeEach(() => {
    h.auth.mockReset()
    h.getEventWithRsvps.mockReset()
    h.getEventsWithDetails.mockReset()
    h.auth.mockResolvedValue({ userId: 'clerk_user_1' })
  })

  it('returns 401 when unauthenticated and does not hit query layer', async () => {
    h.auth.mockResolvedValueOnce({ userId: null })

    const res = await GET(makeRequest('/api/events/evt_1'), {
      params: Promise.resolve({ id: 'evt_1' }),
    })
    const { status, body } = await jsonOf(res)

    expect(status).toBe(401)
    expect(body).toEqual({
      success: false,
      error: 'Unauthorized',
    })
    expect(h.getEventsWithDetails).not.toHaveBeenCalled()
    expect(h.getEventWithRsvps).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid rsvpStatus and does not hit query layer', async () => {
    const res = await GET(makeRequest('/api/events/evt_1?rsvpStatus=weird'), {
      params: Promise.resolve({ id: 'evt_1' }),
    })
    const { status, body } = await jsonOf(res)

    expect(status).toBe(400)
    expect(body).toEqual({
      success: false,
      error: 'Invalid rsvpStatus',
    })
    expect(h.getEventsWithDetails).not.toHaveBeenCalled()
    expect(h.getEventWithRsvps).not.toHaveBeenCalled()
  })

  it('defaults missing rsvpStatus to confirmed path', async () => {
    h.getEventsWithDetails.mockResolvedValueOnce([
      { id: 'evt_1', title: 'Event', rsvps: [] },
    ])

    const res = await GET(makeRequest('/api/events/evt_1'), {
      params: Promise.resolve({ id: 'evt_1' }),
    })
    const { status, body } = await jsonOf(res)

    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: { id: 'evt_1', title: 'Event', rsvps: [] },
    })
    expect(h.getEventsWithDetails).toHaveBeenCalledTimes(1)
    expect(h.getEventsWithDetails).toHaveBeenCalledWith({
      where: { id: 'evt_1' },
      take: 1,
    })
    expect(h.getEventWithRsvps).not.toHaveBeenCalled()
  })

  it('uses full route for pending/canceled and filters by requested status', async () => {
    h.getEventWithRsvps.mockResolvedValueOnce({
      id: 'evt_1',
      rsvps: [
        { status: 'pending', user: { clerkId: 'u1' } },
        { status: 'confirmed', user: { clerkId: 'u2' } },
      ],
    })

    const res = await GET(makeRequest('/api/events/evt_1?rsvpStatus=pending'), {
      params: Promise.resolve({ id: 'evt_1' }),
    })
    const { status, body } = await jsonOf(res)

    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: {
        id: 'evt_1',
        rsvps: [{ status: 'pending', user: { clerkId: 'u1' } }],
      },
    })
    expect(h.getEventsWithDetails).not.toHaveBeenCalled()
    expect(h.getEventWithRsvps).toHaveBeenCalledTimes(1)
    expect(h.getEventWithRsvps).toHaveBeenCalledWith('evt_1')
  })
})

