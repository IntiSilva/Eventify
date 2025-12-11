import type { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { getCurrentUserPhoneNumber } from '@/lib/viewer'
import CreateEventForm from '@/components/FormsRelated/CreateEventForm'

export const metadata: Metadata = {
  title: 'Create Event',
  robots: { index: false, follow: false },
  alternates: { canonical: '/events/new' },
}

export default async function Page() {
  const { userId } = await auth()

  const profilePhoneNumber = userId ? await getCurrentUserPhoneNumber() : null

  return <CreateEventForm profilePhoneNumber={profilePhoneNumber} />
}
