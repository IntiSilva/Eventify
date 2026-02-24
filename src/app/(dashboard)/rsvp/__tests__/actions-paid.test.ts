import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { ToggleRsvpResult } from '@/types/rsvp';

const h = vi.hoisted(() => ({
  authUserId: 'user_123',
  prisma: {
    rSVP: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
    },
    event: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@clerk/nextjs/server', () => {
  return {
    auth: async () => ({ userId: h.authUserId }),
  };
});

vi.mock('@/lib/prisma', () => {
  return { prisma: h.prisma };
});

vi.mock('@/lib/constants', () => {
  const FEATURED_THRESHOLD = 5 as const;
  const computeAutoFeatured = (confirmedCount: number): boolean => {
    return confirmedCount >= FEATURED_THRESHOLD;
  };
  return { FEATURED_THRESHOLD, computeAutoFeatured };
});

vi.mock('@/lib/payments/confirmPaidRsvp', () => {
  return {
    linkRsvpToSucceededPayment: vi.fn(),
  };
});

import { toggleRSVP, reactivateAlreadyPaidRsvp } from '@/app/(dashboard)/rsvp/actions';

const makeRsvp = (id: string, eventId: string, userId: string) => ({
  id,
  eventId,
  userId,
  status: 'confirmed' as const,
});

type CreatedOK = Extract<ToggleRsvpResult, { success: true; action: 'created' }>;
type CancelledOK = Extract<ToggleRsvpResult, { success: true; action: 'cancelled' }>;
type PaymentRequiredOK = Extract<ToggleRsvpResult, { success: true; action: 'payment_required' }>;

describe('rsvp/actions.toggleRSVP with paid events', () => {
  beforeEach(() => {
    h.prisma.rSVP.findUnique.mockReset();
    h.prisma.rSVP.create.mockReset();
    h.prisma.rSVP.delete.mockReset();
    h.prisma.rSVP.count.mockReset();
    h.prisma.event.findUnique.mockReset();
    h.prisma.event.update.mockReset();
    h.authUserId = 'user_123';
  });

  describe('New RSVP on free events', () => {
    it('creates RSVP immediately for free event', async () => {
      const EVENT_ID = 'evt_free_1';
      const USER_ID = h.authUserId;

      h.prisma.rSVP.findUnique.mockResolvedValueOnce(null);
      h.prisma.event.findUnique.mockResolvedValueOnce({
        id: EVENT_ID,
        isPaid: false,
      });

      h.prisma.rSVP.create.mockResolvedValueOnce({
        id: 'rsvp_1',
        eventId: EVENT_ID,
        userId: USER_ID,
        status: 'confirmed',
        reminderPreferenceType: null,
        reminderOffsetMinutes: null,
        reminderScheduledAt: null,
        reminderSentAt: null,
        user: {
          clerkId: USER_ID,
          username: 'testuser',
          firstName: 'Test',
          lastName: 'User',
          imageUrl: null,
          hasImage: false,
          role: 'user',
        },
      });

      h.prisma.rSVP.count.mockResolvedValueOnce(1);
      h.prisma.event.update.mockResolvedValueOnce({
        id: EVENT_ID,
        featured: false,
      });

      const result = await toggleRSVP(EVENT_ID);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success=true');

      expect(result.action).toBe('created');
      if (result.action !== 'created') throw new Error('Expected action="created"');

      const ok: CreatedOK = result;
      expect(ok.newRsvp).toBeDefined();
      expect(ok.updatedEvent).toBeDefined();
      expect(h.prisma.rSVP.create).toHaveBeenCalled();
    });
  });

  describe('New RSVP on paid events', () => {
    it('returns payment_required for paid event without creating RSVP', async () => {
      const EVENT_ID = 'evt_paid_1';
      const USER_ID = h.authUserId;

      h.prisma.rSVP.findUnique.mockResolvedValueOnce(null);
      h.prisma.event.findUnique.mockResolvedValueOnce({
        id: EVENT_ID,
        isPaid: true,
      });

      const result = await toggleRSVP(EVENT_ID);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success=true');

      expect(result.action).toBe('payment_required');
      if (result.action !== 'payment_required') throw new Error('Expected action="payment_required"');

      const ok: PaymentRequiredOK = result;
      expect(ok.eventId).toBe(EVENT_ID);
      expect(ok.isPaid).toBe(true);
      expect(ok.message).toContain('Payment required');

      // Verify RSVP was NOT created
      expect(h.prisma.rSVP.create).not.toHaveBeenCalled();
    });

    it('returns payment_required without querying attendee count', async () => {
      const EVENT_ID = 'evt_paid_2';

      h.prisma.rSVP.findUnique.mockResolvedValueOnce(null);
      h.prisma.event.findUnique.mockResolvedValueOnce({
        id: EVENT_ID,
        isPaid: true,
      });

      const result = await toggleRSVP(EVENT_ID);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success=true');

      expect(result.action).toBe('payment_required');
      if (result.action !== 'payment_required') throw new Error('Expected action="payment_required"');

      // Verify count and update were NOT called (since RSVP wasn't created)
      expect(h.prisma.rSVP.count).not.toHaveBeenCalled();
      expect(h.prisma.event.update).not.toHaveBeenCalled();
    });
  });

  describe('Cancel RSVP on both free and paid events', () => {
    it('cancels RSVP on free event', async () => {
      const EVENT_ID = 'evt_free_2';
      const USER_ID = h.authUserId;

      h.prisma.rSVP.findUnique.mockResolvedValueOnce(makeRsvp('rsvp_1', EVENT_ID, USER_ID));
      h.prisma.rSVP.delete.mockResolvedValueOnce(makeRsvp('rsvp_1', EVENT_ID, USER_ID));
      h.prisma.rSVP.count.mockResolvedValueOnce(0);
      h.prisma.event.update.mockResolvedValueOnce({
        id: EVENT_ID,
        featured: false,
      });

      const result = await toggleRSVP(EVENT_ID);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success=true');

      expect(result.action).toBe('cancelled');
      if (result.action !== 'cancelled') throw new Error('Expected action="cancelled"');

      const ok: CancelledOK = result;
      expect(ok.rsvpCancelled).toBe(true);
      expect(h.prisma.rSVP.delete).toHaveBeenCalled();
    });

    it('cancels RSVP on paid event (does not require payment)', async () => {
      const EVENT_ID = 'evt_paid_3';
      const USER_ID = h.authUserId;

      h.prisma.rSVP.findUnique.mockResolvedValueOnce(makeRsvp('rsvp_1', EVENT_ID, USER_ID));
      h.prisma.rSVP.delete.mockResolvedValueOnce(makeRsvp('rsvp_1', EVENT_ID, USER_ID));
      h.prisma.rSVP.count.mockResolvedValueOnce(2);
      h.prisma.event.update.mockResolvedValueOnce({
        id: EVENT_ID,
        featured: false,
      });

      // Note: no need to check isPaid for cancellation
      const result = await toggleRSVP(EVENT_ID);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success=true');

      expect(result.action).toBe('cancelled');
      expect(h.prisma.rSVP.delete).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('returns error when event not found on new RSVP', async () => {
      const EVENT_ID = 'evt_missing';

      h.prisma.rSVP.findUnique.mockResolvedValueOnce(null);
      h.prisma.event.findUnique.mockResolvedValueOnce(null);

      const result = await toggleRSVP(EVENT_ID);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('Reactivate already-paid RSVP (regression: paid -> cancel -> attend again)', () => {
    it('reactivates RSVP for user who already paid but canceled', async () => {
      const EVENT_ID = 'evt_paid_reactivate';
      const USER_ID = h.authUserId;
      const PAYMENT_ID = 'pay_1';

      // Event is paid
      h.prisma.event.findUnique.mockResolvedValueOnce({
        id: EVENT_ID,
        isPaid: true,
      });

      // Find succeeded payment (exists even though RSVP was deleted)
      h.prisma.payment.findFirst.mockResolvedValueOnce({
        id: PAYMENT_ID,
        eventId: EVENT_ID,
        userId: USER_ID,
        status: 'succeeded',
        stripePaymentIntentId: 'pi_1',
      });

      // linkRsvpToSucceededPayment is mocked (tested separately)
      // This would normally do transaction: upsert RSVP + link Payment + recalc featured
      const { linkRsvpToSucceededPayment } = await import('@/lib/payments/confirmPaidRsvp');
      let linkCalled = false;
      (linkRsvpToSucceededPayment as any).mockImplementation(async () => {
        linkCalled = true;
        return { paymentId: PAYMENT_ID, rsvpId: 'rsvp_new', confirmedCount: 1, eventId: EVENT_ID };
      });

      // Count for featured recalc
      h.prisma.rSVP.count.mockResolvedValueOnce(1);

      // Update event featured
      h.prisma.event.update.mockResolvedValueOnce({
        id: EVENT_ID,
        featured: false,
      });

      const result = await reactivateAlreadyPaidRsvp(EVENT_ID);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success=true');

      expect(result.action).toBe('reactivated');
      if (result.action !== 'reactivated') throw new Error('Expected action="reactivated"');

      type ReactivatedOK = Extract<ToggleRsvpResult, { success: true; action: 'reactivated' }>;
      const ok: ReactivatedOK = result;

      expect(ok.message).toContain('restored');
      expect(ok.updatedEvent).toBeDefined();
      expect(ok.updatedEvent.featured).toBe(false);
      expect(linkCalled).toBe(true);
    });

    it('returns error when event not found during reactivation', async () => {
      const EVENT_ID = 'evt_missing';

      h.prisma.event.findUnique.mockResolvedValueOnce(null);

      const result = await reactivateAlreadyPaidRsvp(EVENT_ID);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('returns error when payment not found for already-paid reactivation', async () => {
      const EVENT_ID = 'evt_paid_no_payment';

      h.prisma.event.findUnique.mockResolvedValueOnce({
        id: EVENT_ID,
        isPaid: true,
      });

      h.prisma.payment.findFirst.mockResolvedValueOnce(null);

      const result = await reactivateAlreadyPaidRsvp(EVENT_ID);

      expect(result.success).toBe(false);
      expect(result.message).toContain('payment');
      expect(result.message).not.toContain('already registered');
    });

    it('returns error if event is not paid', async () => {
      const EVENT_ID = 'evt_free';

      h.prisma.event.findUnique.mockResolvedValueOnce({
        id: EVENT_ID,
        isPaid: false,
      });

      const result = await reactivateAlreadyPaidRsvp(EVENT_ID);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not a paid event');
    });
  });

  describe('UI state synchronization for reactivation (no page refresh required)', () => {
    it('reactivation result includes updated event for UI commit', async () => {
      const EVENT_ID = 'evt_ui_sync';
      const USER_ID = h.authUserId;
      const PAYMENT_ID = 'pay_ui_test';

      h.prisma.event.findUnique.mockResolvedValueOnce({
        id: EVENT_ID,
        isPaid: true,
      });

      h.prisma.payment.findFirst.mockResolvedValueOnce({
        id: PAYMENT_ID,
        eventId: EVENT_ID,
        userId: USER_ID,
        status: 'succeeded',
        stripePaymentIntentId: 'pi_ui',
      });

      const { linkRsvpToSucceededPayment } = await import('@/lib/payments/confirmPaidRsvp');
      (linkRsvpToSucceededPayment as any).mockImplementation(async () => ({
        paymentId: PAYMENT_ID,
        rsvpId: 'rsvp_ui_new',
        confirmedCount: 5,  // Updated count for attendees
        eventId: EVENT_ID,
      }));

      h.prisma.rSVP.count.mockResolvedValueOnce(5);
      h.prisma.event.update.mockResolvedValueOnce({
        id: EVENT_ID,
        featured: true,  // Featured status may have changed
      });

      const result = await reactivateAlreadyPaidRsvp(EVENT_ID);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');

      // Verify updated event is returned for UI commit
      if (result.action !== 'reactivated') throw new Error('Expected reactivated');
      
      const reactivated = result;
      expect(reactivated.updatedEvent).toBeDefined();
      expect(reactivated.updatedEvent.attendeesConfirmedCount).toBe(5);
      expect(reactivated.updatedEvent.featured).toBe(true);
    });
  });
});
