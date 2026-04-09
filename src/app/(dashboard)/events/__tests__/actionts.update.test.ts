import { describe, it, expect, beforeEach, vi } from 'vitest'
import { updateEvent, type UpdateEventResult } from '@/app/(dashboard)/events/actions'
import { EventCategory, UserRole } from '@/generated/prisma'
import type { EventWithCreatorAndRsvps } from '@/types/event'

/* ----------------------- Hoisted, typed mocks ----------------------- */
  // Keep all top-level values inside vi.hoisted() to avoid hoist issues.
  const h = vi.hoisted(() => {
  // Minimal event factory used by the prisma mock
  const makeEvent = (overrides?: Partial<EventWithCreatorAndRsvps>): EventWithCreatorAndRsvps => {
    const { archivedAt, ...restOverrides } = overrides ?? {}
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
      isPaid: false,
      priceCents: null,
      currency: null,
      currentPriceVersionId: null,
      archivedAt: archivedAt ?? null,
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
      ...restOverrides,
    }
  }

  /* ---- Types for the prisma functions we’ll mock ---- */
  type FindUniqueUser = (args: {
    where: { clerkId: string },
    select: {
      role: true;
      clerkId: true;
      stripeConnectAccountId: true;
      stripeConnectPayoutsEnabled: true;
      stripeConnectChargesEnabled: true;
      stripeConnectDetailsSubmitted: true;
    }
  }) => Promise<{
    role: UserRole;
    clerkId: string;
    stripeConnectAccountId: string | null;
    stripeConnectPayoutsEnabled: boolean;
    stripeConnectChargesEnabled: boolean;
    stripeConnectDetailsSubmitted: boolean;
  } | null>

  type FindUniqueEvent = (args: { where: { id: string } }) =>
    Promise<Pick<EventWithCreatorAndRsvps, 'id' | 'createdBy' | 'date' | 'eventTimeZone' | 'isPaid' | 'priceCents' | 'currency' | 'currentPriceVersionId'> | null>

  type UpdateEventFn = (args: {
    where: { id: string },
    data: Record<string, unknown>,
    include: Record<string, unknown>
  }) => Promise<EventWithCreatorAndRsvps>

  // Mocks
  const authMock = vi.fn<() => Promise<{ userId: string | null }>>()
  const findUniqueUserMock = vi.fn<FindUniqueUser>()
  const findUniqueEventMock = vi.fn<FindUniqueEvent>()
  const updateEventMock = vi.fn<UpdateEventFn>()
  const paymentFindFirstMock = vi.fn()
  const txPriceVersionFindFirstMock = vi.fn()
  const txPriceVersionUpdateManyMock = vi.fn()
  const txPriceVersionCreateMock = vi.fn()
  const transactionMock = vi.fn()
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
    paymentFindFirstMock,
    txPriceVersionFindFirstMock,
    txPriceVersionUpdateManyMock,
    txPriceVersionCreateMock,
    transactionMock,
    revalidatePathMock,
    canonicalizeTimeZone,
    isValidIanaTimeZone,
    normalizeStringForSearch,
    yyyymmddKey,
    computeEventLocalKeys,
    stripDiacritics,
    connectReady: undefined as boolean | undefined,
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
    payment: {
      findFirst: h.paymentFindFirstMock,
    },
    eventPriceVersion: {
      findFirst: h.txPriceVersionFindFirstMock,
      updateMany: h.txPriceVersionUpdateManyMock,
      create: h.txPriceVersionCreateMock,
    },
    $transaction: h.transactionMock,
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: h.revalidatePathMock,
}))

vi.mock('@/lib/payments/stripeConnectReadiness', async () => {
  const { buildConnectConfigMock } = await import('@/test-utils/mockConnectConfig')
  return buildConnectConfigMock(h)
})

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
  h.paymentFindFirstMock.mockReset()
  h.txPriceVersionFindFirstMock.mockReset()
  h.txPriceVersionUpdateManyMock.mockReset()
  h.txPriceVersionCreateMock.mockReset()
  h.transactionMock.mockReset()
  h.revalidatePathMock.mockReset()
  h.connectReady = undefined
})

/* ================================ TESTS =================================== */

describe('events/actions.updateEvent', () => {
  it('allows admin to update title/location and normalizes fields', async () => {
    // Given an admin user and an existing event owned by someone else
    h.authMock.mockResolvedValue({ userId: 'admin_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.admin,
      clerkId: 'admin_1',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent({ createdBy: 'org_1' })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
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
      expect(result.updatedEvent?.creator.clerkId).toBe(existing.creator.clerkId)
      expect(Array.isArray(result.updatedEvent?.rsvps)).toBe(true)
      expect(result.updatedEvent?.location).toBe(' Córdoba ')
    }
  })

  it('blocks organizer updating an event they do not own', async () => {
    h.authMock.mockResolvedValue({ userId: 'org_2' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.organizer,
      clerkId: 'org_2',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent({ createdBy: 'org_1' })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    const result = await updateEvent({
      id: existing.id,
      title: 'Attempted edit',
    })

    expect(result.success).toBe(false)
    expect(result.message).toBe('Forbidden: You can only update your own events.')
    expect(h.updateEventMock).not.toHaveBeenCalled()
  })

  it('blocks organizer from updating a free event into paid unless Stripe Connect is fully enabled', async () => {
    h.authMock.mockResolvedValue({ userId: 'org_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.organizer,
      clerkId: 'org_1',
      stripeConnectAccountId: 'acct_incomplete',
      stripeConnectPayoutsEnabled: true,
      stripeConnectChargesEnabled: true,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent({
      createdBy: 'org_1',
      isPaid: true,
      priceCents: 2500,
      currency: 'USD',
      currentPriceVersionId: 'pv_1',
      date: new Date('2099-11-10T18:00:00.000Z'),
    })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    const result = await updateEvent({
      id: existing.id,
      isPaid: true,
      priceCents: 5500,
      currency: 'USD',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Paid events require an organizer')
    expect(h.transactionMock).not.toHaveBeenCalled()
    expect(h.updateEventMock).not.toHaveBeenCalled()
    expect(h.paymentFindFirstMock).not.toHaveBeenCalled()
  })

  it('allows organizer free-to-paid update when Stripe Connect is fully enabled', async () => {
    h.authMock.mockResolvedValue({ userId: 'org_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.organizer,
      clerkId: 'org_1',
      stripeConnectAccountId: 'acct_ready',
      stripeConnectPayoutsEnabled: true,
      stripeConnectChargesEnabled: true,
      stripeConnectDetailsSubmitted: true,
    })

    const existing = h.makeEvent({
      createdBy: 'org_1',
      isPaid: false,
      priceCents: null,
      currency: null,
      currentPriceVersionId: 'pv_1',
      date: new Date('2099-11-10T18:00:00.000Z'),
    })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    h.paymentFindFirstMock.mockResolvedValue(null)
    h.txPriceVersionFindFirstMock.mockResolvedValue({ versionNumber: 1 })
    h.txPriceVersionUpdateManyMock.mockResolvedValue({ count: 1 })
    h.txPriceVersionCreateMock.mockResolvedValue({ id: 'pv_2' })
    h.updateEventMock.mockResolvedValue(
      h.makeEvent({
        createdBy: 'org_1',
        isPaid: true,
        priceCents: 5500,
        currency: 'USD',
        currentPriceVersionId: 'pv_2',
      })
    )

    h.transactionMock.mockImplementation(
      async (
        cb: (tx: {
          event: { update: typeof h.updateEventMock }
          eventPriceVersion: {
            findFirst: typeof h.txPriceVersionFindFirstMock
            updateMany: typeof h.txPriceVersionUpdateManyMock
            create: typeof h.txPriceVersionCreateMock
          }
        }) => Promise<EventWithCreatorAndRsvps>
      ) =>
        cb({
          event: { update: h.updateEventMock },
          eventPriceVersion: {
            findFirst: h.txPriceVersionFindFirstMock,
            updateMany: h.txPriceVersionUpdateManyMock,
            create: h.txPriceVersionCreateMock,
          },
        })
    )

    const result = await updateEvent({
      id: existing.id,
      isPaid: true,
      priceCents: 5500,
      currency: 'USD',
    })

    expect(result.success).toBe(true)
    expect(h.transactionMock).toHaveBeenCalledTimes(1)
    expect(h.updateEventMock).toHaveBeenCalledTimes(1)
  })

  it('blocks admins from flipping an organizer event to paid when the organizer creator is not ready', async () => {
    h.authMock.mockResolvedValue({ userId: 'admin_1' })
    h.findUniqueUserMock
      .mockResolvedValueOnce({
        role: UserRole.admin,
        clerkId: 'admin_1',
        stripeConnectAccountId: null,
        stripeConnectPayoutsEnabled: false,
        stripeConnectChargesEnabled: false,
        stripeConnectDetailsSubmitted: false,
      })
      .mockResolvedValueOnce({
        role: UserRole.organizer,
        clerkId: 'org_1',
        stripeConnectAccountId: 'acct_incomplete',
        stripeConnectPayoutsEnabled: true,
        stripeConnectChargesEnabled: true,
        stripeConnectDetailsSubmitted: false,
      })

    const existing = h.makeEvent({
      createdBy: 'org_1',
      isPaid: false,
      priceCents: null,
      currency: null,
      currentPriceVersionId: 'pv_1',
      date: new Date('2099-11-10T18:00:00.000Z'),
    })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    const result = await updateEvent({
      id: existing.id,
      isPaid: true,
      priceCents: 5500,
      currency: 'USD',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Paid events require an organizer')
    expect(h.transactionMock).not.toHaveBeenCalled()
    expect(h.updateEventMock).not.toHaveBeenCalled()
  })

  it('allows admins to flip an organizer event to paid when the organizer creator is ready', async () => {
    h.authMock.mockResolvedValue({ userId: 'admin_1' })
    h.findUniqueUserMock
      .mockResolvedValueOnce({
        role: UserRole.admin,
        clerkId: 'admin_1',
        stripeConnectAccountId: null,
        stripeConnectPayoutsEnabled: false,
        stripeConnectChargesEnabled: false,
        stripeConnectDetailsSubmitted: false,
      })
      .mockResolvedValueOnce({
        role: UserRole.organizer,
        clerkId: 'org_1',
        stripeConnectAccountId: 'acct_ready',
        stripeConnectPayoutsEnabled: true,
        stripeConnectChargesEnabled: true,
        stripeConnectDetailsSubmitted: true,
      })

    const existing = h.makeEvent({
      createdBy: 'org_1',
      isPaid: false,
      priceCents: null,
      currency: null,
      currentPriceVersionId: 'pv_1',
      date: new Date('2099-11-10T18:00:00.000Z'),
    })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    h.paymentFindFirstMock.mockResolvedValue(null)
    h.txPriceVersionFindFirstMock.mockResolvedValue({ versionNumber: 1 })
    h.txPriceVersionUpdateManyMock.mockResolvedValue({ count: 1 })
    h.txPriceVersionCreateMock.mockResolvedValue({ id: 'pv_2' })
    h.updateEventMock.mockResolvedValue(
      h.makeEvent({
        createdBy: 'org_1',
        isPaid: true,
        priceCents: 5500,
        currency: 'USD',
        currentPriceVersionId: 'pv_2',
      })
    )

    h.transactionMock.mockImplementation(
      async (
        cb: (tx: {
          event: { update: typeof h.updateEventMock }
          eventPriceVersion: {
            findFirst: typeof h.txPriceVersionFindFirstMock
            updateMany: typeof h.txPriceVersionUpdateManyMock
            create: typeof h.txPriceVersionCreateMock
          }
        }) => Promise<EventWithCreatorAndRsvps>
      ) =>
        cb({
          event: { update: h.updateEventMock },
          eventPriceVersion: {
            findFirst: h.txPriceVersionFindFirstMock,
            updateMany: h.txPriceVersionUpdateManyMock,
            create: h.txPriceVersionCreateMock,
          },
        })
    )

    const result = await updateEvent({
      id: existing.id,
      isPaid: true,
      priceCents: 5500,
      currency: 'USD',
    })

    expect(result.success).toBe(true)
    expect(h.transactionMock).toHaveBeenCalledTimes(1)
    expect(h.updateEventMock).toHaveBeenCalledTimes(1)
  })

  it('allows admins to flip their own admin-owned event to paid in platform mode', async () => {
    h.authMock.mockResolvedValue({ userId: 'admin_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.admin,
      clerkId: 'admin_1',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent({
      createdBy: 'admin_1',
      creator: {
        clerkId: 'admin_1',
        username: 'admin',
        firstName: 'Admin',
        lastName: 'User',
        imageUrl: null,
        hasImage: false,
        role: UserRole.admin,
      },
      isPaid: false,
      priceCents: null,
      currency: null,
      currentPriceVersionId: 'pv_1',
      date: new Date('2099-11-10T18:00:00.000Z'),
    })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    h.paymentFindFirstMock.mockResolvedValue(null)
    h.txPriceVersionFindFirstMock.mockResolvedValue({ versionNumber: 1 })
    h.txPriceVersionUpdateManyMock.mockResolvedValue({ count: 1 })
    h.txPriceVersionCreateMock.mockResolvedValue({ id: 'pv_2' })
    h.updateEventMock.mockResolvedValue(
      h.makeEvent({
        createdBy: 'admin_1',
        creator: {
          clerkId: 'admin_1',
          username: 'admin',
          firstName: 'Admin',
          lastName: 'User',
          imageUrl: null,
          hasImage: false,
          role: UserRole.admin,
        },
        isPaid: true,
        priceCents: 5500,
        currency: 'USD',
        currentPriceVersionId: 'pv_2',
      })
    )

    h.transactionMock.mockImplementation(
      async (
        cb: (tx: {
          event: { update: typeof h.updateEventMock }
          eventPriceVersion: {
            findFirst: typeof h.txPriceVersionFindFirstMock
            updateMany: typeof h.txPriceVersionUpdateManyMock
            create: typeof h.txPriceVersionCreateMock
          }
        }) => Promise<EventWithCreatorAndRsvps>
      ) =>
        cb({
          event: { update: h.updateEventMock },
          eventPriceVersion: {
            findFirst: h.txPriceVersionFindFirstMock,
            updateMany: h.txPriceVersionUpdateManyMock,
            create: h.txPriceVersionCreateMock,
          },
        })
    )

    const result = await updateEvent({
      id: existing.id,
      isPaid: true,
      priceCents: 5500,
      currency: 'USD',
    })

    expect(result.success).toBe(true)
    expect(h.transactionMock).toHaveBeenCalledTimes(1)
    expect(h.updateEventMock).toHaveBeenCalledTimes(1)
  })

  it('blocks non-pricing edits on already-paid events when the creator is no longer Connect-ready', async () => {
    h.authMock.mockResolvedValue({ userId: 'org_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.organizer,
      clerkId: 'org_1',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent({
      createdBy: 'org_1',
      isPaid: true,
      priceCents: 2500,
      currency: 'USD',
      currentPriceVersionId: 'pv_1',
      date: new Date('2099-11-10T18:00:00.000Z'),
    })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    const result = await updateEvent({
      id: existing.id,
      title: 'Updated title',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Paid events require an organizer')
    expect(h.transactionMock).not.toHaveBeenCalled()
    expect(h.updateEventMock).not.toHaveBeenCalled()
    expect(h.paymentFindFirstMock).not.toHaveBeenCalled()
  })

  it('recomputes local keys on TZ-only change (date unchanged)', async () => {
    h.authMock.mockResolvedValue({ userId: 'org_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.organizer,
      clerkId: 'org_1',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent({ createdBy: 'org_1', date: new Date('2099-10-10T10:00:00.000Z') })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
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
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.organizer,
      clerkId: 'org_1',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent({ createdBy: 'org_1', eventTimeZone: 'UTC' })
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
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
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.admin,
      clerkId: 'admin_1',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent()
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
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
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.admin,
      clerkId: 'admin_1',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent()
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
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

  it('rejects midnight crossover updates that are <4h away in absolute time and returns validation envelope', async () => {
    // 2025-11-03 23:30 in America/Argentina/Buenos_Aires
    vi.setSystemTime(new Date('2025-11-04T02:30:00.000Z'))

    h.authMock.mockResolvedValue({ userId: 'admin_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.admin,
      clerkId: 'admin_1',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent()
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    // 2025-11-04 00:30 in America/Argentina/Buenos_Aires (only +60 min away)
    const promise = updateEvent({
      id: existing.id,
      date: '2025-11-04T03:30:00.000Z',
      eventTimeZone: 'America/Argentina/Buenos_Aires',
    })

    await expect(promise).resolves.toMatchObject({
      success: false,
      message: 'Validation failed. Please check the form fields.',
    })

    const result = await promise
    const errors = (result as Exclude<UpdateEventResult, { success: true }>).errors
    expect(errors?.date?._errors?.some((m) => /at least 4 hours/i.test(m))).toBe(true)
    expect(h.updateEventMock).not.toHaveBeenCalled()
  })

  it('rejects updates at 239 minutes lead time', async () => {
    vi.setSystemTime(new Date('2025-11-03T12:00:00.000Z'))

    h.authMock.mockResolvedValue({ userId: 'admin_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.admin,
      clerkId: 'admin_1',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent()
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    const res = await updateEvent({
      id: existing.id,
      date: '2025-11-03T15:59:00.000Z', // +239 min
      eventTimeZone: 'UTC',
    })

    expect(res.success).toBe(false)
    expect(res.message).toBe('Validation failed. Please check the form fields.')
    const errors = (res as Exclude<UpdateEventResult, { success: true }>).errors
    expect(errors?.date?._errors?.some((m) => /at least 4 hours/i.test(m))).toBe(true)
    expect(h.updateEventMock).not.toHaveBeenCalled()
  })

  it('allows updates at exactly 240 minutes lead time', async () => {
    vi.setSystemTime(new Date('2025-11-03T12:00:00.000Z'))

    h.authMock.mockResolvedValue({ userId: 'admin_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.admin,
      clerkId: 'admin_1',
      stripeConnectAccountId: null,
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
    })

    const existing = h.makeEvent()
    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    h.updateEventMock.mockImplementation(async ({ data }) => {
      const d = data as { date?: Date }
      return h.makeEvent({
        date: d.date ?? existing.date,
      })
    })

    const res = await updateEvent({
      id: existing.id,
      date: '2025-11-03T16:00:00.000Z', // +240 min
      eventTimeZone: 'UTC',
    })

    expect(res.success).toBe(true)
    expect(h.updateEventMock).toHaveBeenCalledTimes(1)
  })

  it('returns hydrated creator + rsvps in the pricing-change transaction path', async () => {
    h.authMock.mockResolvedValue({ userId: 'org_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.organizer,
      clerkId: 'org_1',
      stripeConnectAccountId: 'acct_org_ready',
      stripeConnectPayoutsEnabled: true,
      stripeConnectChargesEnabled: true,
      stripeConnectDetailsSubmitted: true,
    })

    const existing = h.makeEvent({
      createdBy: 'org_1',
      isPaid: true,
      priceCents: 1000,
      currency: 'USD',
      currentPriceVersionId: 'pv_1',
      date: new Date('2025-11-05T20:00:00.000Z'),
    })

    h.findUniqueEventMock.mockResolvedValue({
      id: existing.id,
      createdBy: existing.createdBy,
      date: existing.date,
      eventTimeZone: existing.eventTimeZone,
      isPaid: existing.isPaid,
      priceCents: existing.priceCents,
      currency: existing.currency,
      currentPriceVersionId: existing.currentPriceVersionId,
    })

    h.paymentFindFirstMock.mockResolvedValue(null)
    h.txPriceVersionFindFirstMock.mockResolvedValue({ versionNumber: 1 })
    h.txPriceVersionUpdateManyMock.mockResolvedValue({ count: 1 })
    h.txPriceVersionCreateMock.mockResolvedValue({ id: 'pv_2' })

    const txUpdatedEvent = h.makeEvent({
      createdBy: 'org_1',
      isPaid: true,
      priceCents: 500,
      currency: 'USD',
      currentPriceVersionId: 'pv_2',
    })
    h.updateEventMock.mockResolvedValue(txUpdatedEvent)

    h.transactionMock.mockImplementation(
      async (
        cb: (tx: {
          event: { update: typeof h.updateEventMock }
          eventPriceVersion: {
            findFirst: typeof h.txPriceVersionFindFirstMock
            updateMany: typeof h.txPriceVersionUpdateManyMock
            create: typeof h.txPriceVersionCreateMock
          }
        }) => Promise<EventWithCreatorAndRsvps>
      ) =>
        cb({
          event: { update: h.updateEventMock },
          eventPriceVersion: {
            findFirst: h.txPriceVersionFindFirstMock,
            updateMany: h.txPriceVersionUpdateManyMock,
            create: h.txPriceVersionCreateMock,
          },
        })
    )

    const result = await updateEvent({
      id: existing.id,
      priceCents: 500,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(h.transactionMock).toHaveBeenCalledTimes(1)
      expect(h.updateEventMock).toHaveBeenCalledTimes(1)

      const call = h.updateEventMock.mock.calls[0][0]
      expect(call.data).toMatchObject({
        isPaid: true,
        priceCents: 500,
        currency: 'USD',
        currentPriceVersionId: 'pv_2',
      })
      expect(call.include).toBeDefined()

      expect(result.updatedEvent?.creator.clerkId).toBe('org_1')
      expect(Array.isArray(result.updatedEvent?.rsvps)).toBe(true)
      expect(result.updatedEvent?.currentPriceVersionId).toBe('pv_2')
      expect(result.updatedEvent?.priceCents).toBe(500)
    }
  })
})
