import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Hoisted container so vi.mock can reference it safely ---------------
const h = vi.hoisted(() => ({
  prisma: {
    event: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
  auth: vi.fn(),
}))

// --- Mocks ---------------------------------------------------------------
// Prisma client
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))

// Constants used by the route (keep PAGE_SIZE_MAIN deterministic)
vi.mock('@/lib/constants', () => ({
  PAGE_SIZE_MAIN: 6,
}))

// Utils used by the route: keep simple & deterministic
vi.mock('@/lib/utils', () => ({
  normalizeStringForSearch: (s: string) => s.toLowerCase().normalize('NFKD'),
  normalizeUsername: (s: string) => s.trim().toLowerCase(),
  parseYyyyMmDdToKey: (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    if (!y || !m || !d) throw new Error('bad date')
    return y * 10000 + m * 100 + d
  },
  yyyymmddKey: (date: Date) => {
    const y = date.getFullYear()
    const m = date.getMonth() + 1
    const d = date.getDate()
    return y * 10000 + m * 100 + d
  },
}))

// Import AFTER mocks so the route picks them up
import { GET } from '@/app/api/events/route'

// Small helper to extract JSON payload from NextResponse
async function jsonOf(res: Response) {
  const body = await res.json()
  return { status: res.status ?? 200, body }
}

describe('/api/events route (minimal integration)', () => {
  beforeEach(() => {
    h.prisma.event.findMany.mockReset()
    h.prisma.event.count.mockReset()
    h.auth.mockReset()
    h.auth.mockResolvedValue({ userId: 'clerk_user_1' })
  })

  it('returns 401 when unauthenticated and does not hit Prisma', async () => {
    h.auth.mockResolvedValueOnce({ userId: null })

    const res = await GET(new Request('http://localhost/api/events?page=1&limit=2'))
    const { status, body } = await jsonOf(res)

    expect(status).toBe(401)
    expect(body).toEqual({
      success: false,
      error: 'Unauthorized',
    })
    expect(h.prisma.event.findMany).not.toHaveBeenCalled()
    expect(h.prisma.event.count).not.toHaveBeenCalled()
  })

  it('uses viewer-day mode when date + viewTz are present (where.date gte/lt, stable orderBy, skip/take)', async () => {
    // Arrange
    const rows = [
      { id: 'evt_1', title: 'A', date: new Date('2099-01-01T10:00:00Z') },
      { id: 'evt_2', title: 'B', date: new Date('2099-01-01T15:00:00Z') },
    ]
    h.prisma.event.findMany.mockResolvedValueOnce(rows)
    h.prisma.event.count.mockResolvedValueOnce(rows.length)

    const url =
      'http://localhost/api/events?date=2025-11-01&viewTz=America/Argentina/Buenos_Aires&page=1&limit=2'
    const req = new Request(url)

    // Act
    const res = await GET(req)
    const { status, body } = await jsonOf(res)

    // Assert: Prisma called with viewer-day window
    expect(h.prisma.event.findMany).toHaveBeenCalledTimes(1)
    const args = h.prisma.event.findMany.mock.calls[0][0]

    expect(args.where?.archivedAt).toBeNull()
    expect(args.where?.date?.gte instanceof Date).toBe(true)
    expect(args.where?.date?.lt instanceof Date).toBe(true)
    expect(args.where?.eventLocalDateKey).toBeUndefined()

    expect(args.orderBy).toEqual([{ date: 'asc' }, { id: 'asc' }])
    expect(args.skip).toBe(0)
    expect(args.take).toBe(2)

    const expected = rows.map(r => ({ ...r, date: r.date.toISOString() }))

    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: expected,
      metadata: {
        totalEvents: rows.length,
        totalPages: 1,
        currentPage: 1,
        eventsPerPage: 2,
      },
    })

    expect(h.prisma.event.count).toHaveBeenCalledTimes(1)
    const countArgs = h.prisma.event.count.mock.calls[0][0]
    expect(countArgs.where).toEqual(args.where)
  })

  it('applies excludeIds and metadata reflects the exclusion', async () => {
    const remaining = [{ id: 'evt_c', title: 'Keep me', date: new Date('2099-01-03T12:00:00Z') }]
    h.prisma.event.findMany.mockResolvedValueOnce(remaining)
    h.prisma.event.count.mockResolvedValueOnce(1)

    const url = 'http://localhost/api/events?excludeIds=evt_a,evt_b&page=1&limit=6'
    const req = new Request(url)

    const res = await GET(req)
    const { status, body } = await jsonOf(res)

    const args = h.prisma.event.findMany.mock.calls[0][0]
    expect(args.where?.archivedAt).toBeNull()
    expect(args.where?.id).toEqual({ notIn: ['evt_a', 'evt_b'] })
    expect(args.orderBy).toEqual([{ date: 'asc' }, { id: 'asc' }])

    const expected = remaining.map(r => ({ ...r, date: r.date.toISOString() }))

    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: expected,
      metadata: {
        totalEvents: 1,
        totalPages: 1,
        currentPage: 1,
        eventsPerPage: 6,
      },
    })

    const countArgs = h.prisma.event.count.mock.calls[0][0]
    expect(countArgs.where).toEqual(args.where)
  })

  it('applies featured=true (returns events with either featured or featuredByAdmin)', async () => {
    const rows = [
      {
        id: 'evt_f1',
        title: 'Feat1',
        date: new Date('2099-02-01T10:00:00Z'),
        featured: true,
        featuredByAdmin: false,
      },
      {
        id: 'evt_f2',
        title: 'AdminFeat',
        date: new Date('2099-02-01T12:00:00Z'),
        featured: false,
        featuredByAdmin: true,
      },
    ]
    h.prisma.event.findMany.mockResolvedValueOnce(rows)
    h.prisma.event.count.mockResolvedValueOnce(rows.length)

    const url = 'http://localhost/api/events?featured=true&page=1&limit=6'
    const res = await GET(new Request(url))
    const { status, body } = await jsonOf(res)

    const args = h.prisma.event.findMany.mock.calls[0][0]
    expect(args.where?.OR).toEqual([{ featured: true }, { featuredByAdmin: true }])
    expect(args.where?.featured).toBeUndefined()
    expect(args.where?.featuredByAdmin).toBeUndefined()

    expect(args.orderBy).toEqual([{ date: 'asc' }, { id: 'asc' }])

    const expected = rows.map(r => ({ ...r, date: r.date.toISOString() }))

    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: expected,
      metadata: {
        totalEvents: rows.length,
        totalPages: 1,
        currentPage: 1,
        eventsPerPage: 6,
      },
    })
  })

  it('applies featured=false (excludes featured/admin events)', async () => {
    const rows = [
      {
        id: 'evt_nf1',
        title: 'Regular',
        date: new Date('2099-03-01T10:00:00Z'),
        featured: false,
        featuredByAdmin: false,
      },
    ]
    h.prisma.event.findMany.mockResolvedValueOnce(rows)
    h.prisma.event.count.mockResolvedValueOnce(rows.length)

    const url = 'http://localhost/api/events?featured=false&page=1&limit=6'
    const res = await GET(new Request(url))
    const { status, body } = await jsonOf(res)

    const args = h.prisma.event.findMany.mock.calls[0][0]
    expect(args.where?.featured).toBe(false)
    expect(args.where?.featuredByAdmin).toBe(false)
    expect(args.where?.OR).toBeUndefined()

    expect(args.orderBy).toEqual([{ date: 'asc' }, { id: 'asc' }])

    const expected = rows.map(r => ({ ...r, date: r.date.toISOString() }))

    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: expected,
      metadata: {
        totalEvents: rows.length,
        totalPages: 1,
        currentPage: 1,
        eventsPerPage: 6,
      },
    })
  })

  it('maps paid=paid to where.isPaid=true', async () => {
    const rows = [
      {
        id: 'evt_paid_1',
        title: 'Paid event',
        date: new Date('2099-04-01T10:00:00Z'),
        isPaid: true,
      },
    ]
    h.prisma.event.findMany.mockResolvedValueOnce(rows)
    h.prisma.event.count.mockResolvedValueOnce(rows.length)

    const res = await GET(new Request('http://localhost/api/events?paid=paid&page=1&limit=6'))
    const { status, body } = await jsonOf(res)

    const args = h.prisma.event.findMany.mock.calls[0][0]
    expect(args.where?.isPaid).toBe(true)

    const expected = rows.map((r) => ({ ...r, date: r.date.toISOString() }))
    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: expected,
      metadata: {
        totalEvents: rows.length,
        totalPages: 1,
        currentPage: 1,
        eventsPerPage: 6,
      },
    })
  })

  it('maps paid=free to where.isPaid=false', async () => {
    const rows = [
      {
        id: 'evt_free_1',
        title: 'Free event',
        date: new Date('2099-04-03T10:00:00Z'),
        isPaid: false,
      },
    ]
    h.prisma.event.findMany.mockResolvedValueOnce(rows)
    h.prisma.event.count.mockResolvedValueOnce(rows.length)

    const res = await GET(new Request('http://localhost/api/events?paid=free&page=1&limit=6'))
    const { status, body } = await jsonOf(res)

    const args = h.prisma.event.findMany.mock.calls[0][0]
    expect(args.where?.isPaid).toBe(false)

    const expected = rows.map((r) => ({ ...r, date: r.date.toISOString() }))
    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: expected,
      metadata: {
        totalEvents: rows.length,
        totalPages: 1,
        currentPage: 1,
        eventsPerPage: 6,
      },
    })
  })
})
