import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import OrganizerStripeOnboardingStep from '@/components/Onboarding/OrganizerStripeOnboardingStep'
import { renderWithProviders, screen } from '@/test/test-utils'

describe('OrganizerStripeOnboardingStep', () => {
  it('renders the Stripe step content with both CTAs immediately', () => {
    renderWithProviders(
      <OrganizerStripeOnboardingStep
        onConnect={vi.fn()}
        onSkip={vi.fn()}
      />
    )

    expect(screen.getByTestId('onb-stripe-step')).toBeInTheDocument()
    expect(screen.getByText(/sell tickets with stripe/i)).toBeInTheDocument()
    expect(screen.getByTestId('onb-connect-copy')).toBeInTheDocument()
    expect(screen.getByTestId('onb-connect-stripe')).toBeVisible()
    expect(screen.getByTestId('onb-skip-connect')).toBeVisible()
  })

  it('wires the connect and skip actions', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    const onSkip = vi.fn()

    renderWithProviders(
      <OrganizerStripeOnboardingStep
        onConnect={onConnect}
        onSkip={onSkip}
      />
    )

    await user.click(screen.getByTestId('onb-connect-stripe'))
    await user.click(screen.getByTestId('onb-skip-connect'))

    expect(onConnect).toHaveBeenCalledTimes(1)
    expect(onSkip).toHaveBeenCalledTimes(1)
  })
})
