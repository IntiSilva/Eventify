import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─────────────────────────── HOISTED MOCKS ───────────────────────────
const m = vi.hoisted(() => {
  type Auth = () => Promise<{ userId: string | null }>
  const authMock = vi.fn<Auth>(async () => ({ userId: 'user_123' }))

  type MinimalEvent = {
    id: string
    title: string
    date: Date
    eventTimeZone: string
  }

  const EVENTS: MinimalEvent[] = [
    {
      id: 'evt_1',
      title: 'First',
      date: new Date('2099-01-01T10:00:00.000Z'),
      eventTimeZone: 'America/Argentina/Buenos_Aires',
    },
    {
      id: 'evt_2',
      title: 'Second',
      date: new Date('2099-01-02T10:00:00.000Z'),
      eventTimeZone: 'America/Argentina/Buenos_Aires',
    },
  ]

  const getUserUpcomingEventsMock = vi.fn<
    (userId: string, opts: { take?: number; skip?: number; readViewerTzCookie: boolean }) => Promise<{ events: MinimalEvent[] }>
  >(async (_userId, _opts) => ({ events: EVENTS }))

  return { authMock, getUserUpcomingEventsMock, EVENTS }
})

// ───────────────────────────── Module mocks ─────────────────────────────
vi.mock('@clerk/nextjs/server', () => ({
  auth: m.authMock,
}))

vi.mock('@/lib/data', () => ({
  getUserUpcomingEvents: m.getUserUpcomingEventsMock,
}))

// SUT
import { GET } from '@/app/api/agenda/upcoming-events/route'

describe('/api/agenda/upcoming-events (GET)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-01-01T12:00:00.000Z'))

    m.authMock.mockResolvedValue({ userId: 'user_123' })
    m.getUserUpcomingEventsMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    m.authMock.mockResolvedValue({ userId: null })

    const req = new Request('http://localhost/api/agenda/upcoming-events')
    const res = await GET(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ success: false, error: 'Unauthorized' })
    expect(m.getUserUpcomingEventsMock).not.toHaveBeenCalled()
  })

  it('returns events and calls getUserUpcomingEvents with defaults (no take/skip)', async () => {
    const req = new Request('http://localhost/api/agenda/upcoming-events')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(m.EVENTS.length)
    expect(body.data[0]).toMatchObject({
      id: 'evt_1',
      title: 'First',
      eventTimeZone: 'America/Argentina/Buenos_Aires',
    })

    expect(m.getUserUpcomingEventsMock).toHaveBeenCalledTimes(1)
    expect(m.getUserUpcomingEventsMock).toHaveBeenCalledWith('user_123', {
      take: undefined,
      skip: undefined,
      readViewerTzCookie: false,
    })
  })

  it('parses positive take/skip numbers', async () => {
    const req = new Request('http://localhost/api/agenda/upcoming-events?take=5&skip=10')
    await GET(req)

    expect(m.getUserUpcomingEventsMock).toHaveBeenCalledWith('user_123', {
      take: 5,
      skip: 10,
      readViewerTzCookie: false,
    })
  })

  it('maps take=0 and negative/invalid values to undefined', async () => {
    const req = new Request('http://localhost/api/agenda/upcoming-events?take=0&skip=-3')
    await GET(req)

    expect(m.getUserUpcomingEventsMock).toHaveBeenCalledWith('user_123', {
      take: undefined,
      skip: undefined,
      readViewerTzCookie: false,
    })

    const req2 = new Request('http://localhost/api/agenda/upcoming-events?take=abc&skip=7')
    await GET(req2)

    expect(m.getUserUpcomingEventsMock).toHaveBeenCalledWith('user_123', {
      take: undefined,
      skip: 7,
      readViewerTzCookie: false,
    })
  })

  it('ignores viewTz param (still readViewerTzCookie:false)', async () => {
    const req = new Request('http://localhost/api/agenda/upcoming-events?viewTz=America%2FNew_York&take=2')
    await GET(req)

    expect(m.getUserUpcomingEventsMock).toHaveBeenCalledWith('user_123', {
      take: 2,
      skip: undefined,
      readViewerTzCookie: false,
    })
  })

  it('returns 500 on internal error with message passthrough', async () => {
    m.getUserUpcomingEventsMock.mockRejectedValueOnce(new Error('db down'))

    const req = new Request('http://localhost/api/agenda/upcoming-events')
    const res = await GET(req)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({
      success: false,
      error: expect.stringContaining('Failed to load upcoming events: db down'),
    })
  })
})
