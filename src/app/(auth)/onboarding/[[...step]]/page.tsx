import type { Metadata } from 'next'
import OnboardingClient from '@/components/Onboarding/OnboardingClient'

export const metadata: Metadata = {
  title: 'Onboarding',
  alternates: { canonical: '/onboarding' },
}

export default function Page() {
  return <OnboardingClient />
}
