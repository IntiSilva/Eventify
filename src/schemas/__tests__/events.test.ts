// src/schemas/__tests__/events.schema.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// ⬇️ Adjust this import if your alias/path differs
import { createEventSchema } from '@/schemas/events'

// If your project exports these enums from Prisma, import them.
// If not, replace with string literals like: const Category = { music: 'music' as const }.
import { EventCategory, ContactPhoneApps } from '@/generated/prisma'

/**
 * Unit tests for the Zod schema only (no UI).
 * Goal: lock down critical business rules (contact methods, dates, TZ, enums/limits).
 * Keep these tests small, deterministic and independent from the form implementation.
 */

describe('createEventSchema (unit)', () => {
  // A valid base object you can tweak per test case
  const BASE = {
    title: 'My Concert',
    description: 'A proper description',
    location: 'Buenos Aires',
    category: EventCategory.music,
    date: new Date('2099-10-10T10:00:00Z'),              // Date real
    tzMode: 'auto' as const,                              // required by schema
    eventTimeZone: 'America/Argentina/Buenos_Aires',      // IANA canonical
    useProfilePhone: false,                               // required by schema
    isPaid: false,                                        // required by schema
    contactEmail: 'organizer@example.com',                // email-only baseline
    contactPhone: undefined as string | undefined,        // no uses null here
    contactPhoneApps: undefined as ContactPhoneApps | undefined,
  }


  // Fix "now" so past/future validations are deterministic
  const FIXED_NOW = new Date('2099-01-01T12:00:00Z')
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  it('accepts a minimal valid payload (email-only contact)', () => {
    const result = createEventSchema.safeParse(BASE)
    expect(result.success).toBe(true)
  })

  it('fails when there is NO contact method (neither email nor phone)', () => {
    const result = createEventSchema.safeParse({
      ...BASE,
      contactEmail: '',
      contactPhone: undefined,
      contactPhoneApps: undefined,
    })

    expect(result.success).toBe(false)

    // We don’t lock to exact error messages to avoid brittle tests.
    // Instead, we loosely assert the error mentions contact/email/phone.
    if (!result.success) {
      const text = JSON.stringify(result.error.issues)
      expect(text).toMatch(/contact|email|phone/i)
    }
  })

  it('requires a valid email format when an email is provided', () => {
    const result = createEventSchema.safeParse({
      ...BASE,
      contactEmail: 'not-an-email',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const text = JSON.stringify(result.error.issues)
      expect(text).toMatch(/email/i)
    }
  })

  it('requires a valid E.164 phone number when phone is provided', () => {
    const result = createEventSchema.safeParse({
      ...BASE,
      contactEmail: '',         // force phone-only path
      contactPhone: '+54',      // invalid phone
      contactPhoneApps: ContactPhoneApps.whatsapp,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const text = JSON.stringify(result.error.issues)
      expect(text).toMatch(/phone/i)
    }
  })

  it('optionally: requires selecting contactPhoneApps when phone is provided (delete if your schema allows missing apps)', () => {
    const result = createEventSchema.safeParse({
      ...BASE,
      contactEmail: '',               // phone-only path
      contactPhone: '+541155555555',  // looks like a valid AR number
      contactPhoneApps: undefined,    // <-- if your schema enforces apps, this should fail
    })

    // If your schema does NOT enforce apps, change this to expect(result.success).toBe(true)
    expect(result.success).toBe(false)
    if (!result.success) {
      const text = JSON.stringify(result.error.issues)
      expect(text).toMatch(/apps|phone/i)
    }
  })

  it('rejects a same-day time earlier than now (create schema rule)', () => {
    // same day as FIXED_NOW, 30 minutes earlier
    const sameDayPast = new Date(FIXED_NOW.getTime() - 30 * 60 * 1000)

    const result = createEventSchema.safeParse({
      ...BASE,
      date: sameDayPast,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/at least 4 hours from now/i);
    }
  })


  it('requires a canonical eventTimeZone (non-empty IANA TZ string)', () => {
    const result = createEventSchema.safeParse({
      ...BASE,
      tzMode: 'manual',
      eventTimeZone: '', // missing TZ should be rejected
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const text = JSON.stringify(result.error.issues)
      expect(text).toMatch(/time|zone|tz/i)
    }
  })

  it('enforces length limits (e.g., title max 60)', () => {
    const overlong = 'X'.repeat(61)
    const result = createEventSchema.safeParse({
      ...BASE,
      title: overlong,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const text = JSON.stringify(result.error.issues)
      expect(text).toMatch(/title|60/i)
    }
  })
})
