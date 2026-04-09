import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET
const ORIGINAL_CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY
const ORIGINAL_FETCH = global.fetch

const h = vi.hoisted(() => ({
  headers: vi.fn(),
  verify: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  fetch: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: h.headers,
}))

vi.mock('svix', () => ({
  Webhook: class {
    verify = h.verify
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: h.prisma,
}))

import { POST } from '@/app/api/webhooks/clerk/route'

const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

describe('POST /api/webhooks/clerk', () => {
  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    process.env.CLERK_SECRET_KEY = 'sk_test'

    h.headers.mockReset()
    h.verify.mockReset()
    h.prisma.user.findUnique.mockReset()
    h.prisma.user.update.mockReset()
    h.prisma.user.create.mockReset()
    h.prisma.user.deleteMany.mockReset()
    h.fetch.mockReset()

    h.headers.mockResolvedValue(
      new Headers({
        'svix-id': 'svix_test',
        'svix-timestamp': '1700000000',
        'svix-signature': 'sig_test',
      })
    )

    h.verify.mockReturnValue({
      type: 'user.created',
      data: {
        id: 'user_123',
        username: 'stale-clerk-name',
        first_name: 'Ada',
        last_name: 'Lovelace',
        has_image: true,
        image_url: 'https://cdn.test/avatar.png',
        primary_email_address_id: 'email_123',
        email_addresses: [
          {
            id: 'email_123',
            email_address: 'ada@example.com',
          },
        ],
      },
    })

    h.fetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    })

    vi.stubGlobal('fetch', h.fetch)
    consoleErrorSpy.mockClear()
    consoleLogSpy.mockClear()
  })

  it('does not reset onboarding or touch stripe/profile fields when a replayed user.created hits an existing linked row', async () => {
    h.prisma.user.findUnique.mockResolvedValueOnce({
      clerkId: 'user_123',
      email: 'existing@example.com',
      username: 'existing_name',
      normalizedUsername: 'existing_name',
      firstName: 'Existing',
      lastName: 'Person',
      imageUrl: 'https://existing.test/avatar.png',
      hasImage: true,
      stripeConnectAccountId: 'acct_123',
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
      stripeConnectDetailsSubmitted: true,
      stripeConnectOnboardingCompletedAt: new Date('2026-03-01T10:00:00.000Z'),
      stripeConnectStatusUpdatedAt: new Date('2026-03-01T10:01:00.000Z'),
    })

    const res = await POST(
      new Request('http://localhost/api/webhooks/clerk', {
        method: 'POST',
        body: '{}',
      })
    )

    expect(res.status).toBe(200)
    expect(h.prisma.user.update).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('only backfills missing identity fields on a replayed user.created', async () => {
    h.prisma.user.findUnique.mockResolvedValueOnce({
      clerkId: 'user_123',
      email: 'existing@example.com',
      username: 'existing_name',
      normalizedUsername: 'existing_name',
      firstName: null,
      lastName: 'Person',
      imageUrl: null,
      hasImage: null,
      stripeConnectAccountId: 'acct_123',
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
      stripeConnectDetailsSubmitted: true,
      stripeConnectOnboardingCompletedAt: new Date('2026-03-01T10:00:00.000Z'),
      stripeConnectStatusUpdatedAt: new Date('2026-03-01T10:01:00.000Z'),
    })
    h.prisma.user.update.mockResolvedValue({})

    const res = await POST(
      new Request('http://localhost/api/webhooks/clerk', {
        method: 'POST',
        body: '{}',
      })
    )

    expect(res.status).toBe(200)
    expect(h.prisma.user.update).toHaveBeenCalledTimes(1)
    expect(h.prisma.user.update).toHaveBeenCalledWith({
      where: { clerkId: 'user_123' },
      data: {
        firstName: 'Ada',
        imageUrl: 'https://cdn.test/avatar.png',
        hasImage: true,
      },
    })

    const updateData = h.prisma.user.update.mock.calls[0]?.[0]?.data as Record<string, unknown>
    expect(updateData).not.toHaveProperty('lastName')
    expect(updateData).not.toHaveProperty('username')
    expect(updateData).not.toHaveProperty('normalizedUsername')
    expect(updateData).not.toHaveProperty('stripeConnectAccountId')
    expect(updateData).not.toHaveProperty('stripeConnectChargesEnabled')
    expect(updateData).not.toHaveProperty('stripeConnectPayoutsEnabled')
    expect(updateData).not.toHaveProperty('stripeConnectDetailsSubmitted')
    expect(updateData).not.toHaveProperty('stripeConnectOnboardingCompletedAt')
    expect(updateData).not.toHaveProperty('stripeConnectStatusUpdatedAt')
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('marks onboarding as pending only for brand-new provisional rows', async () => {
    h.prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    h.prisma.user.create.mockResolvedValue({})

    const res = await POST(
      new Request('http://localhost/api/webhooks/clerk', {
        method: 'POST',
        body: '{}',
      })
    )

    expect(res.status).toBe(200)
    expect(h.prisma.user.create).toHaveBeenCalledTimes(1)
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.fetch).toHaveBeenCalledWith(
      'https://api.clerk.com/v1/users/user_123/metadata',
      expect.objectContaining({
        method: 'PATCH',
      })
    )
  })
})

afterAll(() => {
  process.env.CLERK_WEBHOOK_SECRET = ORIGINAL_CLERK_WEBHOOK_SECRET
  process.env.CLERK_SECRET_KEY = ORIGINAL_CLERK_SECRET_KEY
  if (ORIGINAL_FETCH) {
    vi.stubGlobal('fetch', ORIGINAL_FETCH)
  }
  consoleErrorSpy.mockRestore()
  consoleLogSpy.mockRestore()
})
