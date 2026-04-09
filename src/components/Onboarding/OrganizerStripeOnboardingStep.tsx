'use client'

import { CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuroraButton } from '@/components/CommonButtons/AuroraButton'

type OrganizerStripeOnboardingStepProps = {
  isPending?: boolean
  onConnect: () => void
  onSkip: () => void
}

const SELL_WITH_STRIPE_BULLETS = [
  'Accept card payments',
  'Automatic payouts',
  'Refunds supported',
] as const

export default function OrganizerStripeOnboardingStep({
  isPending = false,
  onConnect,
  onSkip,
}: OrganizerStripeOnboardingStepProps) {
  return (
    <div
      data-testid="onb-stripe-step"
      className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-300/80">
            Optional
          </p>
          <h2 className="text-xl font-semibold text-white font-heading">
            Sell tickets with Stripe
          </h2>
        </div>

        <span className="inline-flex size-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
          <CreditCard className="size-5" aria-hidden="true" />
        </span>
      </div>

      <ul className="mt-4 space-y-2 text-sm text-zinc-300">
        {SELL_WITH_STRIPE_BULLETS.map((bullet) => (
          <li key={bullet} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      <p data-testid="onb-connect-copy" className="mt-4 text-sm leading-6 text-zinc-200">
        Connect Stripe to accept card payments for tickets and receive payouts. You can
        skip for now. You&apos;ll be able to create free events only.
      </p>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <AuroraButton
          type="button"
          data-testid="onb-connect-stripe"
          variant="outline"
          className="w-full cursor-pointer mt-0 bg-black text-white border border-zinc-900 hover:border-zinc-700 hover:bg-emerald-700/20 hover:text-white transition-colors duration-300 ease-in-out sm:w-auto"
          disabled={isPending}
          onClick={onConnect}
        >
          {isPending ? 'Connecting...' : 'Connect Stripe'}
        </AuroraButton>

        <Button
          type="button"
          data-testid="onb-skip-connect"
          variant="outline"
          className="cursor-pointer border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.06]"
          disabled={isPending}
          onClick={onSkip}
        >
          Not now
        </Button>
      </div>
    </div>
  )
}
