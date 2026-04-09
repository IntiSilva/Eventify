import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import OrganizerStripeConnectHint from '@/components/Organizer/OrganizerStripeConnectHint'
import { renderWithProviders, screen, waitFor } from '@/test/test-utils'

const h = vi.hoisted(() => ({
  startConnectOnboarding: vi.fn(),
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/(dashboard)/organizer/actions', () => ({
  startConnectOnboarding: h.startConnectOnboarding,
}))

vi.mock('sonner', () => ({
  toast: h.toast,
}))

describe('OrganizerStripeConnectHint', () => {
  beforeEach(() => {
    h.startConnectOnboarding.mockReset()
    h.toast.error.mockReset()
  })

  it('starts Stripe Connect onboarding and redirects to Stripe', async () => {
    const user = userEvent.setup()
    const redirectSpy = vi.fn()
    h.startConnectOnboarding.mockResolvedValue({
      success: true,
      url: 'https://connect.stripe.test/onboarding',
      status: {
        accountId: 'acct_123',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        onboardingCompletedAt: null,
        statusUpdatedAt: null,
      },
    })

    renderWithProviders(<OrganizerStripeConnectHint onRedirect={redirectSpy} />)

    await user.click(screen.getByRole('button', { name: /connect stripe/i }))

    await waitFor(() => {
      expect(h.startConnectOnboarding).toHaveBeenCalledTimes(1)
      expect(redirectSpy).toHaveBeenCalledWith('https://connect.stripe.test/onboarding')
    })
  })
})
