import { describe, expect, it, vi } from 'vitest'
import {
  advanceOrganizerPhoneStep,
  getOnboardingProgress,
} from '@/components/Onboarding/onboardingFlow'

describe('getOnboardingProgress', () => {
  it('uses four steps for organizers', () => {
    expect(getOnboardingProgress(3, 'organizer')).toEqual({
      currentStep: 3,
      totalSteps: 4,
    })
  })

  it('keeps the user flow at a three-step progress label on the final action state', () => {
    expect(getOnboardingProgress(2, 'user')).toEqual({
      currentStep: 3,
      totalSteps: 3,
    })
  })

  it('only persists organizer phone details when the saved profile changed', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const profile = {
      username: 'organizer_one',
      role: 'organizer' as const,
      phoneNumber: '+5491123456789',
    }

    const first = await advanceOrganizerPhoneStep({
      current: profile,
      lastSaved: null,
      persist,
    })

    const second = await advanceOrganizerPhoneStep({
      current: profile,
      lastSaved: first.savedProfile,
      persist,
    })

    const third = await advanceOrganizerPhoneStep({
      current: {
        ...profile,
        phoneNumber: '+5491199999999',
      },
      lastSaved: second.savedProfile,
      persist,
    })

    expect(first.didPersist).toBe(true)
    expect(second.didPersist).toBe(false)
    expect(third.didPersist).toBe(true)
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenNthCalledWith(1, first.savedProfile)
    expect(persist).toHaveBeenNthCalledWith(2, third.savedProfile)
  })
})
