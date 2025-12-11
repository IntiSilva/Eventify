import { describe, it, expect, beforeEach, vi } from 'vitest'
import { updateEvent, type UpdateEventResult } from '@/app/(dashboard)/events/actions'
import { EventCategory, UserRole } from '@/generated/prisma'
import type { EventWithCreatorAndRsvps } from '@/types/event'

/* ----------------------- Hoisted, typed mocks ----------------------- */
// Keep all top-level values inside vi.hoisted() to avoid hoist issues.
const h = vi.hoisted(() => {
  // Minimal event factory used by the prisma mock
  const makeEvent = (overrides?: Partial<EventWithCreatorAndRsvps>): EventWithCreatorAndRsvps => {
    const now = new Date('2099-10-10T10:00:00.000Z')
    return {
      id: 'evt_1',
      title: 'Title',
      normalizedTitle: 'title',
      description: 'Desc',
      date: now,
      eventTimeZone: 'UTC',
      eventLocalDateKey: 20991010,
      eventLocalMinuteOfDay: 10 * 60,
      location: 'BA',
      normalizedLocation: 'ba',
      category: EventCategory.music,
      featured: false,
      featuredByAdmin: false,
      createdBy: 'org_1',
      contactEmail: 'user@example.com',
      contactPhone: null,
      contactPhoneApps: null,
      createdAt: now,
      creator: {
        clerkId: 'org_1',
        username: 'org',
        firstName: 'Org',
        lastName: 'User',
        imageUrl: null,
        hasImage: false,
        role: UserRole.organizer,
      },
      rsvps: [],
      ...overrides,
    }
  }

  /* ---- Types for the prisma functions we’ll mock ---- */
  type FindUniqueUser = (args: {
    where: { clerkId: string },
    select: { role: true; clerkId: true }
  }) => Promise<{ role: UserRole; clerkId: string } | null>

  type FindUniqueEvent = (args: { where: { id: string } }) =>
    Promise<Pick<EventWithCreatorAndRsvps, 'id' | 'createdBy' | 'date' | 'eventTimeZone'> | null>

  type UpdateEventFn = (args: {
    where: { id: string },
    data: Record<string, unknown>,
    include: { creator: true; rsvps: true }
  }) => Promise<EventWithCreatorAndRsvps>

  // Mocks
  const authMock = vi.fn<() => Promise<{ userId: string | null }>>()
  const findUniqueUserMock = vi.fn<FindUniqueUser>()
  const findUniqueEventMock = vi.fn<FindUniqueEvent>()
  const updateEventMock = vi.fn<UpdateEventFn>()
  const revalidatePathMock = vi.fn<(path: string) => void>()

  // Utils used by the action (deterministic, typed)
  const stripDiacritics = (s: string) =>
    s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const canonicalizeTimeZone = (tz?: string | null) => (tz ?? 'UTC')
  const isValidIanaTimeZone = (_tz: string) => true
  const normalizeStringForSearch = (s: string) =>
    stripDiacritics(s).trim().toLowerCase()
  const yyyymmddKey = (d: Date) =>
    d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
  const computeEventLocalKeys = (date: Date, _tz: string) => {
    // Keep the logic simple & stable for tests: derive keys from UTC parts
    const key = date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate()
    const minute = date.getUTCHours() * 60 + date.getUTCMinutes()
    return { eventLocalDateKey: key, eventLocalMinuteOfDay: minute }
  }

  return {
    makeEvent,
    authMock,
    findUniqueUserMock,
    findUniqueEventMock,
    updateEventMock,
    revalidatePathMock,
    canonicalizeTimeZone,
    isValidIanaTimeZone,
    normalizeStringForSearch,
    yyyymmddKey,
    computeEventLocalKeys,
    stripDiacritics,
  }
})

/* ------------------------------ Module mocks ------------------------------ */
vi.mock('@clerk/nextjs/server', () => ({
  auth: h.authMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: h.findUniqueUserMock },
    event: {
      findUnique: h.findUniqueEventMock,
      update: h.updateEventMock,
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: h.revalidatePathMock,
}))

// Make date-fns-tz deterministic (identity transform is enough here)
vi.mock('date-fns-tz', () => ({
  toZonedTime: (d: Date) => new Date(d),
}))

// Provide only the utilities used in actions.ts with stable behavior
vi.mock('@/lib/utils', () => ({
  DEFAULT_EVENT_TZ: 'UTC',
  canonicalizeTimeZone: (tz?: string | null) => h.canonicalizeTimeZone(tz),
  isValidIanaTimeZone: (tz: string) => h.isValidIanaTimeZone(tz),
  normalizeStringForSearch: (s: string) => h.normalizeStringForSearch(s),
  yyyymmddKey: (d: Date) => h.yyyymmddKey(d),
  computeEventLocalKeys: (date: Date, tz: string) => h.computeEventLocalKeys(date, tz),
}))

/* --------------------------------- Clock ---------------------------------- */
beforeEach(() => {
  vi.useFakeTimers()
  // Freeze time so "past / same-day / +2y" logic is deterministic
  vi.setSystemTime(new Date('2025-11-03T15:00:00.000Z'))

  h.authMock.mockReset()
  h.findUniqueUserMock.mockReset()
  h.findUniqueEventMock.mockReset()
  h.updateEventMock.mockReset()
  h.revalidatePathMock.mockReset()
})

/* ================================ TESTS =================================== */

describe('events/actions.updateEvent', () => {
  it('allows admin to update title/location and normalizes fields', async () => {
    // Given an admin user and an existing event owned by someone else
    h.authMock.mockResolvedValue({ userId: 'admin_1' })
    h.findUniqueUserMock.mockResolvedValue({ role: UserRole.admin, clerkId: 'admin_1' })

    const existing = h.makeEvent({ createdBy: 'org_1' })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
    })

    // Capture the "update" payload and echo a merged result
    h.updateEventMock.mockImplementation(async ({ data }) => {
      const d = data as {
        title?: string
        location?: string
        normalizedTitle?: string
        normalizedLocation?: string
      }
      return h.makeEvent({
        title: d.title ?? existing.title,
        normalizedTitle: d.normalizedTitle ?? existing.normalizedTitle,
        location: d.location ?? existing.location,
        normalizedLocation: d.normalizedLocation ?? existing.normalizedLocation,
      })
    })

    const result = await updateEvent({
      id: existing.id,
      title: '  My NEW Title ',
      location: ' Córdoba ',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(h.updateEventMock).toHaveBeenCalledTimes(1)
      const call = h.updateEventMock.mock.calls[0][0]
      expect(call.data).toMatchObject({
        title: '  My NEW Title ',
        normalizedTitle: 'my new title',
        location: ' Córdoba ',
        // Normalize = trim + lowercase + strip diacritics
        normalizedLocation: ' Córdoba '.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''),
      })

      // Revalidate affected paths
      expect(h.revalidatePathMock).toHaveBeenCalledWith('/')
      expect(h.revalidatePathMock).toHaveBeenCalledWith('/organizer')
      expect(h.revalidatePathMock).toHaveBeenCalledWith('/admin')

      // Returned event echoes updated fields
      expect(result.updatedEvent?.title).toBe('  My NEW Title ')
      expect(result.updatedEvent?.location).toBe(' Córdoba ')
    }
  })

  it('blocks organizer updating an event they do not own', async () => {
    h.authMock.mockResolvedValue({ userId: 'org_2' })
    h.findUniqueUserMock.mockResolvedValue({ role: UserRole.organizer, clerkId: 'org_2' })

    const existing = h.makeEvent({ createdBy: 'org_1' })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
    })

    const result = await updateEvent({
      id: existing.id,
      title: 'Attempted edit',
    })

    expect(result.success).toBe(false)
    expect(result.message).toBe('Forbidden: You can only update your own events.')
    expect(h.updateEventMock).not.toHaveBeenCalled()
  })

  it('recomputes local keys on TZ-only change (date unchanged)', async () => {
    h.authMock.mockResolvedValue({ userId: 'org_1' })
    h.findUniqueUserMock.mockResolvedValue({ role: UserRole.organizer, clerkId: 'org_1' })

    const existing = h.makeEvent({ createdBy: 'org_1', date: new Date('2099-10-10T10:00:00.000Z') })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
    })

    h.updateEventMock.mockImplementation(async ({ data }) => {
      const d = data as {
        eventTimeZone: string
        eventLocalDateKey: number
        eventLocalMinuteOfDay: number
      }
      return h.makeEvent({
        eventTimeZone: d.eventTimeZone,
        eventLocalDateKey: d.eventLocalDateKey,
        eventLocalMinuteOfDay: d.eventLocalMinuteOfDay,
      })
    })

    const result = await updateEvent({
      id: existing.id,
      eventTimeZone: 'America/New_York',
    })

    expect(result.success).toBe(true)
    const expectedKeys = h.computeEventLocalKeys(existing.date, 'America/New_York')
    const call = h.updateEventMock.mock.calls[0][0]
    expect(call.data).toMatchObject({
      eventTimeZone: 'America/New_York',
      eventLocalDateKey: expectedKeys.eventLocalDateKey,
      eventLocalMinuteOfDay: expectedKeys.eventLocalMinuteOfDay,
    })
  })

  it('recomputes local keys when updating the date (TZ canonicalized)', async () => {
    h.authMock.mockResolvedValue({ userId: 'org_1' })
    h.findUniqueUserMock.mockResolvedValue({ role: UserRole.organizer, clerkId: 'org_1' })

    const existing = h.makeEvent({ createdBy: 'org_1', eventTimeZone: 'UTC' })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
    })

    // IMPORTANT: must be within +2 years of the frozen clock (2025-11-03)
    const newUtc = new Date('2027-10-10T18:30:00.000Z')

    h.updateEventMock.mockImplementation(async ({ data }) => {
      const d = data as {
        date: Date
        eventTimeZone: string
        eventLocalDateKey: number
        eventLocalMinuteOfDay: number
      }
      return h.makeEvent({
        date: d.date,
        eventTimeZone: d.eventTimeZone,
        eventLocalDateKey: d.eventLocalDateKey,
        eventLocalMinuteOfDay: d.eventLocalMinuteOfDay,
      })
    })

    const result: UpdateEventResult = await updateEvent({
      id: existing.id,
      date: newUtc.toISOString(),
      eventTimeZone: 'America/Argentina/Buenos_Aires',
    })

    expect(result.success).toBe(true)
    const expectedKeys = h.computeEventLocalKeys(newUtc, 'America/Argentina/Buenos_Aires')
    const call = h.updateEventMock.mock.calls[0][0]
    expect(call.data).toMatchObject({
      date: newUtc,
      eventTimeZone: 'America/Argentina/Buenos_Aires',
      eventLocalDateKey: expectedKeys.eventLocalDateKey,
      eventLocalMinuteOfDay: expectedKeys.eventLocalMinuteOfDay,
    })
  })

  it('returns a validation error when contactPhone is provided but contactPhoneApps is missing', async () => {
    h.authMock.mockResolvedValue({ userId: 'admin_1' })
    h.findUniqueUserMock.mockResolvedValue({ role: UserRole.admin, clerkId: 'admin_1' })

    const existing = h.makeEvent()
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
    })

    const res = await updateEvent({
      id: existing.id,
      contactPhone: '123456',
      // contactPhoneApps intentionally omitted
    })

    expect(res.success).toBe(false)
    const errors = (res as Exclude<UpdateEventResult, { success: true }>).errors
    expect(errors?.contactPhoneApps?._errors?.length ?? 0).toBeGreaterThan(0)
  })

  it('returns a validation error when date is in the past (in final TZ)', async () => {
    h.authMock.mockResolvedValue({ userId: 'admin_1' })
    h.findUniqueUserMock.mockResolvedValue({ role: UserRole.admin, clerkId: 'admin_1' })

    const existing = h.makeEvent()
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
    })

    // Now is frozen at 2025-11-03T15:00Z – pick a past date
    const pastIso = '2025-11-02T10:00:00.000Z'

    const res = await updateEvent({
      id: existing.id,
      date: pastIso,
      eventTimeZone: 'UTC',
    })

    expect(res.success).toBe(false)
    const errors = (res as Exclude<UpdateEventResult, { success: true }>).errors
    expect(errors?.date?._errors?.some((m) => /cannot be in the past/i.test(m))).toBe(true)
  })
})
