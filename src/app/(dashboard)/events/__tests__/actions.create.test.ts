import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventCategory } from '@/generated/prisma'

/**
 * Shared, hoisted state so it survives module reloads between tests.
 * We store the exact Prisma create() args to assert normalization & keys,
 * without depending on the returned shape from the action.
 */
const h = vi.hoisted(() => ({
  createdArgs: [] as Array<{ data: Record<string, unknown> }>,
  priceVersionArgs: [] as Array<{ data: Record<string, unknown> }>,
  eventUpdateArgs: [] as Array<{ data: Record<string, unknown>; where: Record<string, unknown> }>,
  connectReady: undefined as boolean | undefined,
  userRow: {
    clerkId: 'user_123',
    role: 'organizer',
    stripeConnectAccountId: null as string | null,
    stripeConnectPayoutsEnabled: false,
    stripeConnectChargesEnabled: false,
    stripeConnectDetailsSubmitted: false,
    username: 'organizer',
    firstName: 'Org',
    lastName: 'User',
    imageUrl: null as string | null,
    hasImage: false,
  },
}))

/* ────────────────────────────────────────────────────────────────────────────
 * Module mocks
 * ────────────────────────────────────────────────────────────────────────────
 */

// Prisma: only the used bits. We record `event.create` payloads.
vi.mock('@/lib/prisma', () => {
  const event = {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      h.createdArgs.push(args)
      // The action returns { success, message, errors }, so the actual return value here won’t be used.
      // We still return something plausible for completeness.
      return { id: 'evt_new', ...args.data }
    }),
    update: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      h.eventUpdateArgs.push(args)
      return { id: 'evt_new', ...args.data }
    }),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  }
  const eventPriceVersion = {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      h.priceVersionArgs.push(args)
      return { id: 'pv_1', ...args.data }
    }),
  }
  const user = {
    findUnique: vi.fn(async () => h.userRow),
  }
  const prisma = {
    event,
    eventPriceVersion,
    user,
    $transaction: vi.fn(async (cb: (tx: { event: typeof event; eventPriceVersion: typeof eventPriceVersion }) => Promise<unknown>) =>
      cb({ event, eventPriceVersion })),
  }
  return { prisma }
})

// next/cache revalidation hooks
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/payments/stripeConnectReadiness', async () => {
  const { buildConnectConfigMock } = await import('@/test-utils/mockConnectConfig')
  return buildConnectConfigMock(h)
})

// Clerk auth: always authenticated as organizer
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => ({ userId: 'user_123' }),
}))

/**
 * utils mock – we provide exactly the exports used by actions.ts:
 * DEFAULT_EVENT_TZ, computeEventLocalKeys, yyyymmddKey, canonicalizeTimeZone,
 * isValidIanaTimeZone, normalizeStringForSearch
 *
 * Note: computeEventLocalKeys uses Intl.DateTimeFormat to compute local Y/M/D and time,
 * which is deterministic and doesn’t require extra deps.
 */
vi.mock('@/lib/utils', () => {
  // Basic default
  const DEFAULT_EVENT_TZ = 'UTC'

  const canonicalizeTimeZone = (tz: string): string => tz

  const isValidIanaTimeZone = (tz: string): boolean => {
    try {
      // Throws on invalid IANA tz
      new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0)
      return true
    } catch {
      return false
    }
  }

  const normalizeStringForSearch = (s: string): string =>
    s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

  const yyyymmddKey = (d: Date): number => {
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const day = d.getDate()
    return y * 10000 + m * 100 + day
  }

  // Compute local date key & minute-of-day for a UTC instant in a given tz
  const computeEventLocalKeys = (utcInstant: Date, tz: string): { eventLocalDateKey: number; eventLocalMinuteOfDay: number } => {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(utcInstant)
    const get = (t: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find(p => p.type === t)?.value ?? 0)

    const year = get('year')
    const month = get('month')
    const day = get('day')
    const hour = get('hour')
    const minute = get('minute')

    const eventLocalDateKey = year * 10000 + month * 100 + day
    const eventLocalMinuteOfDay = hour * 60 + minute
    return { eventLocalDateKey, eventLocalMinuteOfDay }
  }

  return {
    DEFAULT_EVENT_TZ,
    canonicalizeTimeZone,
    isValidIanaTimeZone,
    normalizeStringForSearch,
    yyyymmddKey,
    computeEventLocalKeys,
  }
})

/**
 * Pull in the actions AFTER mocks are in place.
 * Using a function keeps the import fresh if a test resets modules.
 */
const importActions = () => import('@/app/(dashboard)/events/actions')

/* ────────────────────────────────────────────────────────────────────────────
 * Time control & cleanup
 * ────────────────────────────────────────────────────────────────────────────
 */

beforeEach(() => {
  h.createdArgs.length = 0
  h.priceVersionArgs.length = 0
  h.eventUpdateArgs.length = 0
  h.connectReady = undefined
  h.userRow.role = 'organizer'
  h.userRow.stripeConnectAccountId = null
  h.userRow.stripeConnectPayoutsEnabled = false
  h.userRow.stripeConnectChargesEnabled = false
  h.userRow.stripeConnectDetailsSubmitted = false
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.clearAllMocks()
})

/* ────────────────────────────────────────────────────────────────────────────
 * Tests
 * ────────────────────────────────────────────────────────────────────────────
 */

describe('events/actions.createEvent (integration-ish)', () => {
  it('creates an event with canonical TZ, normalized fields, and denormalized local keys', async () => {
    // Freeze a stable "now" (the exact instant doesn’t affect the happy path assertions)
    vi.setSystemTime(new Date('2099-10-01T12:00:00.000Z'))

    const { createEvent } = await importActions()

    // Realistic payload: future UTC instant, valid tz, at least one contact method
    const payload = {
      title: 'My GREAT Title ',
      description: 'Long event description',
      date: '2099-10-10T10:00:00.000Z',
      location: '  Buenos Aires  ',
      category: EventCategory.music,
      contactEmail: 'user@example.com',
      contactPhone: null,
      contactPhoneApps: undefined,
      eventTimeZone: 'America/Argentina/Buenos_Aires',
    }

    const result = await createEvent(payload)

    // The action returns a typed success envelope
    expect(result).toEqual({
      success: true,
      message: expect.any(String),
      errors: null,
    })

    // Prisma was hit once with the normalized/canonicalized data
    expect(h.createdArgs).toHaveLength(1)
    const created = h.createdArgs[0]
    const data = created.data

    // Title normalization
    expect(data['title']).toBe('My GREAT Title ')
    expect(data['normalizedTitle']).toBe('my great title')

    // Location normalization
    expect(data['location']).toBe('  Buenos Aires  ')
    expect(data['normalizedLocation']).toBe('buenos aires')

    // Stored UTC date (string parsed by the action)
    expect(data['date']).toBeInstanceOf(Date)
    // Canonicalized tz flows through
    expect(data['eventTimeZone']).toBe('America/Argentina/Buenos_Aires')

    // Denormalized local keys present and sane
    const dateKey = data['eventLocalDateKey']
    const minuteOfDay = data['eventLocalMinuteOfDay']
    expect(typeof dateKey).toBe('number')
    expect(dateKey).toBeGreaterThan(20000000)
    expect(typeof minuteOfDay).toBe('number')
    expect(minuteOfDay).toBeGreaterThanOrEqual(0)
    expect(minuteOfDay).toBeLessThan(24 * 60)

    // Creator should be set by the action with the authenticated clerkId
    expect(data['createdBy']).toBe('user_123')

    // Contact fields mirror input (nullable ok)
    expect(data['contactEmail']).toBe('user@example.com')
    expect(data['contactPhone']).toBeNull()

    // Initial pricing version is created and linked (full pricing versioning MVP)
    expect(h.priceVersionArgs).toHaveLength(1)
    expect(h.priceVersionArgs[0]?.data).toMatchObject({
      eventId: 'evt_new',
      versionNumber: 1,
      isPaid: false,
      amountCents: null,
      currency: null,
      createdBy: 'user_123',
    })
    expect(h.eventUpdateArgs).toHaveLength(1)
    expect(h.eventUpdateArgs[0]?.data).toMatchObject({
      currentPriceVersionId: 'pv_1',
    })
  })

  it('rejects a same-day event scheduled under ~4h window (does not hit DB)', async () => {
    // Freeze to Nov 3, 2025 12:00 UTC
    vi.setSystemTime(new Date('2025-11-03T12:00:00.000Z'))

    const { createEvent } = await importActions()

    // Same-day, +2h -> should fail by policy
    const payload = {
      title: 'Too Soon',
      description: 'Should be rejected',
      date: '2025-11-03T14:00:00.000Z',
      eventTimeZone: 'UTC',
      location: 'Test',
      category: EventCategory.music,
      contactEmail: 'user@example.com',
      contactPhone: null,
      contactPhoneApps: undefined,
    }

    const result = await createEvent(payload)

    // No DB writes
    expect(h.createdArgs).toHaveLength(0)

    // Action returns a typed failure envelope; the exact field errors depend on Zod
    expect(result.success).toBe(false)
    expect(typeof result.message).toBe('string')
    // If the action surfaced Zod field errors, `date` should be implicated
    if (result.errors) {
      const serialized = JSON.stringify(result.errors)
      expect(serialized.toLowerCase()).toContain('date')
    }
    expect(result.message).toBe('Validation failed. Please check the form fields.')
    expect(result.message).not.toContain('Database error')
  })

  it('rejects midnight crossover events that are <4h away in absolute time', async () => {
    // 2025-11-03 23:30 in America/Argentina/Buenos_Aires
    vi.setSystemTime(new Date('2025-11-04T02:30:00.000Z'))

    const { createEvent } = await importActions()

    // 2025-11-04 00:30 in America/Argentina/Buenos_Aires (only +60 min away)
    const payload = {
      title: 'Midnight Crossover Too Soon',
      description: 'Should be rejected by absolute lead-time policy',
      date: '2025-11-04T03:30:00.000Z',
      eventTimeZone: 'America/Argentina/Buenos_Aires',
      location: 'Test',
      category: EventCategory.music,
      contactEmail: 'user@example.com',
      contactPhone: null,
      contactPhoneApps: undefined,
    }

    const result = await createEvent(payload)

    expect(result.success).toBe(false)
    expect(result.message).toBe('Validation failed. Please check the form fields.')
    expect(h.createdArgs).toHaveLength(0)
    const serialized = JSON.stringify(result.errors)
    expect(serialized.toLowerCase()).toContain('date')
    expect(serialized.toLowerCase()).toContain('at least 4 hours')
  })

  it('rejects events at 239 minutes lead time and accepts exactly 240 minutes', async () => {
    vi.setSystemTime(new Date('2025-11-03T12:00:00.000Z'))
    const { createEvent } = await importActions()

    const basePayload = {
      title: 'Boundary check',
      description: 'lead-time boundary test',
      eventTimeZone: 'UTC',
      location: 'Boundary Hall',
      category: EventCategory.music,
      contactEmail: 'user@example.com',
      contactPhone: null,
      contactPhoneApps: undefined,
    } as const

    const tooSoon = await createEvent({
      ...basePayload,
      date: '2025-11-03T15:59:00.000Z', // +239 min
    })
    expect(tooSoon.success).toBe(false)
    expect(tooSoon.message).toBe('Validation failed. Please check the form fields.')
    expect(h.createdArgs).toHaveLength(0)

    const exactlyFourHours = await createEvent({
      ...basePayload,
      date: '2025-11-03T16:00:00.000Z', // +240 min
    })
    expect(exactlyFourHours.success).toBe(true)
    expect(h.createdArgs).toHaveLength(1)
  })

  it('blocks paid event creation for organizers unless Stripe Connect is fully enabled', async () => {
    vi.setSystemTime(new Date('2099-10-01T12:00:00.000Z'))
    h.userRow.role = 'organizer'
    h.userRow.stripeConnectAccountId = 'acct_test_incomplete'
    h.userRow.stripeConnectPayoutsEnabled = false
    h.userRow.stripeConnectChargesEnabled = true
    h.userRow.stripeConnectDetailsSubmitted = true

    const { createEvent } = await importActions()

    const payload = {
      title: 'Paid Event',
      description: 'Paid event should be blocked without Stripe Connect payouts',
      date: '2099-10-10T10:00:00.000Z',
      location: 'Test venue',
      category: EventCategory.music,
      contactEmail: 'user@example.com',
      contactPhone: null,
      contactPhoneApps: undefined,
      eventTimeZone: 'UTC',
      isPaid: true,
      priceCents: 5500,
      currency: 'USD',
    }

    const result = await createEvent(payload)

    expect(result.success).toBe(false)
    expect(result.message).toContain('Paid events require an organizer')
    expect(h.createdArgs).toHaveLength(0)
    expect(h.priceVersionArgs).toHaveLength(0)
    expect(h.eventUpdateArgs).toHaveLength(0)
  })

  it('allows paid event creation for admins using platform payout mode', async () => {
    vi.setSystemTime(new Date('2099-10-01T12:00:00.000Z'))
    h.userRow.role = 'admin'
    h.userRow.stripeConnectAccountId = 'acct_admin'
    h.userRow.stripeConnectPayoutsEnabled = true
    h.userRow.stripeConnectChargesEnabled = true
    h.userRow.stripeConnectDetailsSubmitted = true

    const { createEvent } = await importActions()

    const payload = {
      title: 'Admin Paid Event',
      description: 'Admins cannot create paid events because they are not organizer-owned',
      date: '2099-10-10T10:00:00.000Z',
      location: 'Admin venue',
      category: EventCategory.music,
      contactEmail: 'user@example.com',
      contactPhone: null,
      contactPhoneApps: undefined,
      eventTimeZone: 'UTC',
      isPaid: true,
      priceCents: 5500,
      currency: 'USD',
    }

    const result = await createEvent(payload)

    expect(result.success).toBe(true)
    expect(h.createdArgs).toHaveLength(1)
    expect(h.priceVersionArgs).toHaveLength(1)
    expect(h.eventUpdateArgs).toHaveLength(1)
  })

  it('allows paid event creation for organizers when Stripe Connect is fully enabled', async () => {
    vi.setSystemTime(new Date('2099-10-01T12:00:00.000Z'))
    h.userRow.role = 'organizer'
    h.userRow.stripeConnectAccountId = 'acct_ready'
    h.userRow.stripeConnectPayoutsEnabled = true
    h.userRow.stripeConnectChargesEnabled = true
    h.userRow.stripeConnectDetailsSubmitted = true

    const { createEvent } = await importActions()

    const payload = {
      title: 'Paid Event Ready',
      description: 'Paid event should pass with fully enabled Stripe Connect',
      date: '2099-10-10T10:00:00.000Z',
      location: 'Ready venue',
      category: EventCategory.music,
      contactEmail: 'user@example.com',
      contactPhone: null,
      contactPhoneApps: undefined,
      eventTimeZone: 'UTC',
      isPaid: true,
      priceCents: 5500,
      currency: 'USD',
    }

    const result = await createEvent(payload)

    expect(result.success).toBe(true)
    expect(h.createdArgs).toHaveLength(1)
    expect(h.priceVersionArgs).toHaveLength(1)
    expect(h.eventUpdateArgs).toHaveLength(1)
  })
})
