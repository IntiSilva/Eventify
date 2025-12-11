import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventsConfirmedCountResponse, EventsConfirmedCountData } from '@/types/api'

// --- Hoisted container ------------------------------------------------------
const h = vi.hoisted(() => ({
  groupByMock: vi.fn(),
}))

// --- Prisma mock ------------------------------------------------------------
// We mock only what the route uses: prisma.rSVP.groupBy
vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      rSVP: {
        groupBy: h.groupByMock,
      },
    },
  }
})

// Import the handler AFTER the mock has been defined.
import { GET } from '@/app/api/events/confirmed-count/route'

// Small helper to create a Request with optional querystring
const makeRequest = (qs = '') =>
  new Request(`https://example.test/api/events/confirmed-count${qs}`, {
    method: 'GET',
  })

describe('GET /api/events/confirmed-count', () => {
  beforeEach(() => {
    h.groupByMock.mockReset()
  })

  it('returns {} and does not hit Prisma when no ids are provided', async () => {
    const res = await GET(makeRequest(''))

    expect(res.status).toBe(200)
    const body = (await res.json()) as EventsConfirmedCountResponse

    expect(body).toEqual({
      success: true,
      data: {} satisfies EventsConfirmedCountData,
    })
    expect(h.groupByMock).not.toHaveBeenCalled()

  })

  it('returns a map with counts and fills 0 for missing ids', async () => {
    const ids = ['a', 'b', 'c']

    // Prisma returns rows only for a and c (b is missing → should be 0)
    h.groupByMock.mockResolvedValueOnce([
      { eventId: 'a', _count: { _all: 2 } },
      { eventId: 'c', _count: { _all: 5 } },
    ])

    const res = await GET(makeRequest(`?ids=${ids.join(',')}`))
    expect(res.status).toBe(200)

    // Validate prisma.rSVP.groupBy call shape
    const callArg = h.groupByMock.mock.calls[0]?.[0]
    expect(callArg).toEqual(
      expect.objectContaining({
        by: ['eventId'],
        _count: { _all: true },
        where: expect.objectContaining({
          status: 'confirmed',
          eventId: { in: ids },
        }),
      })
    )

    // Response includes all requested ids, defaulting to 0 for missing rows
    const body = (await res.json()) as EventsConfirmedCountResponse
    expect(body).toEqual({
      success: true,
      data: { a: 2, b: 0, c: 5 },
    })
  })

  it('trims tokens and preserves duplicates in the IN clause; response still maps missing to 0', async () => {
    // With the current route logic:
    // "?ids= ,a, a , ,b,,"  →  ['a','a','b']  (empties removed, duplicates preserved)
    h.groupByMock.mockResolvedValueOnce([
      { eventId: 'a', _count: { _all: 3 } }, // only "a" has rows
    ])

    const res = await GET(makeRequest('?ids= ,a, a , ,b,,'))
    expect(res.status).toBe(200)

    // Ensure the IN clause matches the trimmed-but-not-deduped ids
    const callArg = h.groupByMock.mock.calls[0]?.[0]
    expect(callArg?.where?.eventId?.in).toEqual(['a', 'a', 'b'])

    // Map must still include all requested ids, with 0 for missing ones
    const body = (await res.json()) as EventsConfirmedCountResponse
    expect(body).toEqual({
      success: true,
      data: { a: 3, b: 0 },
    })
  })
})
