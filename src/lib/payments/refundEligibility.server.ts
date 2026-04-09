export type RefundBlockedReason = 'NO_PAYMENT' | 'EVENT_STARTED' | 'CUTOFF' | 'UNKNOWN'

type ComputeRefundEligibilityInput = {
  hasPayment: boolean
  eventStartsAt?: Date | null
  now?: Date
  cutoffHours: number
}

type RefundEligibilityResult = {
  canRequest: boolean
  blockedReason: RefundBlockedReason | null
}

export function computeRefundEligibility(
  input: ComputeRefundEligibilityInput
): RefundEligibilityResult {
  if (!input.hasPayment) {
    return {
      canRequest: false,
      blockedReason: 'NO_PAYMENT',
    }
  }

  const eventStartsAt = input.eventStartsAt
  if (!eventStartsAt || Number.isNaN(eventStartsAt.getTime())) {
    return {
      canRequest: false,
      blockedReason: 'UNKNOWN',
    }
  }

  const now = input.now ?? new Date()
  if (eventStartsAt.getTime() <= now.getTime()) {
    return {
      canRequest: false,
      blockedReason: 'EVENT_STARTED',
    }
  }

  const cutoffMs = input.cutoffHours * 60 * 60 * 1000
  if (eventStartsAt.getTime() - now.getTime() < cutoffMs) {
    return {
      canRequest: false,
      blockedReason: 'CUTOFF',
    }
  }

  return {
    canRequest: true,
    blockedReason: null,
  }
}
