import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToggleRsvpResult } from '@/types/rsvp'

// --- Hoisted container ------------------------------------------------------
const h = vi.hoisted(() => ({
  authUserId: 'user_123',
  prisma: {
    rSVP: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    event: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

// --- Mocks ------------------------------------------------------------------
vi.mock('@clerk/nextjs/server', () => {
  return {
    auth: async () => ({ userId: h.authUserId }),
  }
})

vi.mock('@/lib/prisma', () => {
  return { prisma: h.prisma }
})

vi.mock('@/lib/constants', () => {
  // Keep the same threshold your app uses (you can tweak for test scenarios)
  const FEATURED_THRESHOLD = 5 as const

  // Same semantics as your real helper: admin flag wins; else threshold
  const computeAutoFeatured = (
    confirmedCount: number,
  ): boolean => {
    return confirmedCount >= FEATURED_THRESHOLD;
  }

  return { FEATURED_THRESHOLD, computeAutoFeatured }
})

// Import AFTER mocks
import { toggleRSVP } from '@/app/(dashboard)/rsvp/actions'

// Small helper for RSVP rows
const makeRsvp = (id: string, eventId: string, userId: string) => ({
  id,
  eventId,
  userId,
  status: 'confirmed' as const,
})

// Narrowing helpers for nicer TS:
type CreatedOK = Extract<ToggleRsvpResult, { success: true; action: 'created' }>
type CancelledOK = Extract<ToggleRsvpResult, { success: true; action: 'cancelled' }>

describe('rsvp/actions.toggleRSVP', () => {
  beforeEach(() => {
    h.prisma.rSVP.findUnique.mockReset()
    h.prisma.rSVP.create.mockReset()
    h.prisma.rSVP.delete.mockReset()
    h.prisma.rSVP.count.mockReset()
    h.prisma.event.findUnique.mockReset()
    h.prisma.event.update.mockReset()
    h.authUserId = 'user_123'
  })

  it('cancels an existing RSVP: deletes, recomputes count, returns action="cancelled"', async () => {
    const EVENT_ID = 'evt_1'
    const USER_ID = h.authUserId

    h.prisma.rSVP.findUnique.mockResolvedValueOnce(makeRsvp('r_1', EVENT_ID, USER_ID))
    h.prisma.rSVP.delete.mockResolvedValueOnce(makeRsvp('r_1', EVENT_ID, USER_ID))
    h.prisma.rSVP.count.mockResolvedValueOnce(4)
    h.prisma.event.update.mockResolvedValueOnce({
      id: EVENT_ID,
      attendeesConfirmedCount: 4,
      featured: false,
    })

    const result = await toggleRSVP(EVENT_ID)

    // Narrow to success branch first
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Expected success=true')

    // Now we can safely access discriminant and narrow further
    expect(result.action).toBe('cancelled')
    if (result.action !== 'cancelled') throw new Error('Expected action="cancelled"')

    const ok: CancelledOK = result

    expect(h.prisma.rSVP.findUnique).toHaveBeenCalledTimes(1)
    expect(h.prisma.rSVP.delete).toHaveBeenCalledTimes(1)
    expect(h.prisma.rSVP.create).not.toHaveBeenCalled()
    expect(h.prisma.rSVP.count).toHaveBeenCalledTimes(1)
    expect(h.prisma.event.update).toHaveBeenCalledTimes(1)

    expect(ok.updatedEvent).toEqual(
      expect.objectContaining({
        id: EVENT_ID,
        attendeesConfirmedCount: 4,
      })
    )
    // In cancel path there should be no newRsvp; assert by property absence
    expect('newRsvp' in ok).toBe(false)
  })

  it('creates a new RSVP: inserts, recomputes count, returns action="created" including the new RSVP', async () => {
    const EVENT_ID = 'evt_2'
    const USER_ID = h.authUserId

    h.prisma.rSVP.findUnique.mockResolvedValueOnce(null)
    h.prisma.event.findUnique.mockResolvedValueOnce({ isPaid: false })
    h.prisma.rSVP.create.mockResolvedValueOnce(makeRsvp('r_new', EVENT_ID, USER_ID))
    h.prisma.rSVP.count.mockResolvedValueOnce(5)
    h.prisma.event.update.mockResolvedValueOnce({
      id: EVENT_ID,
      attendeesConfirmedCount: 5,
      featured: true, // threshold mocked to 5
    })

    const result = await toggleRSVP(EVENT_ID)

    // Narrow to success
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Expected success=true')

    expect(result.action).toBe('created')
    if (result.action !== 'created') throw new Error('Expected action="created"')

    const ok: CreatedOK = result

    expect(h.prisma.rSVP.findUnique).toHaveBeenCalledTimes(1)
    expect(h.prisma.rSVP.create).toHaveBeenCalledTimes(1)
    expect(h.prisma.rSVP.delete).not.toHaveBeenCalled()
    expect(h.prisma.rSVP.count).toHaveBeenCalledTimes(1)
    expect(h.prisma.event.update).toHaveBeenCalledTimes(1)

    expect(ok.updatedEvent).toEqual(
      expect.objectContaining({
        id: EVENT_ID,
        attendeesConfirmedCount: 5,
      })
    )
    // Created branch must include the new RSVP
    expect(ok.newRsvp).toEqual(
      expect.objectContaining({
        eventId: EVENT_ID,
        userId: USER_ID,
      })
    )
  })

  it('throws when user is not authenticated', async () => {
    // If your action returns a structured failure instead of throwing,
    // adjust this test accordingly.
    h.authUserId = null as unknown as string

    await expect(toggleRSVP('evt_unauth')).rejects.toThrowError()

    expect(h.prisma.rSVP.findUnique).not.toHaveBeenCalled()
    expect(h.prisma.rSVP.create).not.toHaveBeenCalled()
    expect(h.prisma.rSVP.delete).not.toHaveBeenCalled()
  })
})
