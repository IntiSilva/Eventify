import type { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { getCurrentUserFromDb } from '@/lib/viewer'
import CreateEventForm from '@/components/FormsRelated/CreateEventForm'
import { UserRole } from '@/generated/prisma'
import { isStripeConnectReady } from '@/lib/payments/stripeConnectReadiness'

export const metadata: Metadata = {
  title: 'Create Event',
  robots: { index: false, follow: false },
  alternates: { canonical: '/events/new' },
}

export default async function Page() {
  const { userId } = await auth()
  const user = userId ? await getCurrentUserFromDb() : null

  const profilePhoneNumber = user?.phoneNumber ?? null
  const hasReadyStripeConnect = isStripeConnectReady(user)
  const shouldRequireStripeConnectForPaidEvents =
    user?.role === UserRole.organizer && !hasReadyStripeConnect

  return (
    <CreateEventForm
      profilePhoneNumber={profilePhoneNumber}
      requireStripeConnectForPaidEvents={shouldRequireStripeConnectForPaidEvents}
    />
  )
}
