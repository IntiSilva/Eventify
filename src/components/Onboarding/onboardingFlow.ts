export type OnboardingRole = 'user' | 'organizer' | undefined

export type OnboardingStep = 1 | 2 | 3 | 4

export type OrganizerProfileSnapshot = {
  username: string
  role: 'organizer'
  phoneNumber: string
}

export function getOnboardingProgress(step: OnboardingStep, role: OnboardingRole) {
  const totalSteps = role === 'organizer' ? 4 : 3
  const currentStep = Math.min(role === 'user' && step === 2 ? 3 : step, totalSteps)

  return {
    currentStep,
    totalSteps,
  }
}

function normalizeOrganizerProfileSnapshot(
  input: OrganizerProfileSnapshot
): OrganizerProfileSnapshot {
  return {
    username: input.username.trim(),
    role: 'organizer',
    phoneNumber: input.phoneNumber.trim(),
  }
}

function isSameOrganizerProfileSnapshot(
  current: OrganizerProfileSnapshot,
  lastSaved: OrganizerProfileSnapshot
) {
  return (
    current.username === lastSaved.username &&
    current.role === lastSaved.role &&
    current.phoneNumber === lastSaved.phoneNumber
  )
}

export async function advanceOrganizerPhoneStep(input: {
  current: OrganizerProfileSnapshot
  lastSaved: OrganizerProfileSnapshot | null
  persist: (profile: OrganizerProfileSnapshot) => Promise<void>
}) {
  const normalized = normalizeOrganizerProfileSnapshot(input.current)

  if (input.lastSaved && isSameOrganizerProfileSnapshot(normalized, input.lastSaved)) {
    return { savedProfile: input.lastSaved, didPersist: false }
  }

  await input.persist(normalized)

  return {
    savedProfile: normalized,
    didPersist: true,
  }
}
