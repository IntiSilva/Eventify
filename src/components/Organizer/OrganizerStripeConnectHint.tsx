'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { startConnectOnboarding } from '@/app/(dashboard)/organizer/actions'

type OrganizerStripeConnectHintProps = {
  onRedirect?: (url: string) => void
}

export default function OrganizerStripeConnectHint({
  onRedirect,
}: OrganizerStripeConnectHintProps) {
  const [isPending, startTransition] = useTransition()

  const handleConnect = () => {
    startTransition(() => {
      void (async () => {
        const result = await startConnectOnboarding()
        if (!result.success) {
          toast.error(result.error)
          return
        }

        if (onRedirect) {
          onRedirect(result.url)
        } else {
          window.location.assign(result.url)
        }
      })()
    })
  }

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 text-sm text-zinc-200">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p>
          Connect Stripe to enable paid events. Until then, you can still create free events.
        </p>

        <button
          type="button"
          onClick={handleConnect}
          disabled={isPending}
          className="rounded-md border border-emerald-500/50 bg-emerald-600/20 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
        >
          Connect Stripe
        </button>
      </div>
    </div>
  )
}
