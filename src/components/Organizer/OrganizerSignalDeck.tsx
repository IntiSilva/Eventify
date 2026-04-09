"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useReducedMotion } from "motion/react"
import {
  AlertTriangle,
  CalendarClock,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  WalletCards,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useViewerTz } from "@/contexts/ViewerTzContext"
import { useMenu } from "@/contexts/MenuContext"
import { capitalizeFirstLetter, cn, formatPrice } from "@/lib/utils"
import type {
  OrganizerOverviewSnapshot,
  OrganizerOverviewTimeSeriesPoint,
  OrganizerOverviewTimeSeriesSnapshot,
} from "@/lib/data"
import type { RefundViewerCounts } from "@/components/Payments/refunds/types/refunds"
import type { EditableEvent } from "@/types/event"
import { RefundsWidget } from "@/components/Payments/refunds/widgets/RefundsWidget"
import { OrganizerPaymentsWidget } from "./OrganizerPaymentsWidget"
import OrganizerTrendCard from "./OrganizerTrendCard"

interface OrganizerSignalDeckProps {
  refundCounts: RefundViewerCounts
  overviewSnapshot: OrganizerOverviewSnapshot
  overviewTimeSeries: OrganizerOverviewTimeSeriesSnapshot
  spotlightEvent: EditableEvent | null
  isStripeReady: boolean
}

interface RiskSignal {
  value: string
  detail: string
  icon: ReactNode
  emphasize: boolean
}

interface OpportunitySignal {
  id: string
  value: string
  detail: string
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatRevenue(amountCents: number, currency: string): string {
  const pretty = formatPrice(amountCents, currency)
  if (pretty) return pretty
  return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`
}

function sumRecentPaidOrders(
  points: OrganizerOverviewTimeSeriesPoint[],
  days: number,
  offsetDays = 0
): number {
  const end = points.length - offsetDays
  if (end <= 0) return 0
  const start = Math.max(0, end - days)
  return points.slice(start, end).reduce((sum, point) => sum + point.paidOrdersSucceeded, 0)
}

function sumRecentRevenueForCurrency(
  points: OrganizerOverviewTimeSeriesPoint[],
  days: number,
  currency: string | null
): number {
  if (!currency) return 0
  const end = points.length
  const start = Math.max(0, end - days)
  const normalizedCurrency = currency.toLowerCase()

  return points.slice(start, end).reduce((sum, point) => {
    return sum + (point.grossBookedRevenueByCurrency[normalizedCurrency] ?? 0)
  }, 0)
}

function selectMostPaidOrdersCurrency(
  rows: OrganizerOverviewSnapshot["grossBookedRevenueByCurrency"]
): OrganizerOverviewSnapshot["grossBookedRevenueByCurrency"][number] | null {
  if (rows.length === 0) return null

  return rows.reduce((best, row) => {
    if (row.paidOrdersSucceeded > best.paidOrdersSucceeded) return row
    if (row.paidOrdersSucceeded < best.paidOrdersSucceeded) return best
    if (row.amountCents > best.amountCents) return row
    if (row.amountCents < best.amountCents) return best
    return row.currency.localeCompare(best.currency) < 0 ? row : best
  }, rows[0])
}

function getPercentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

function buildRiskSignal(input: {
  isStripeReady: boolean
  upcomingEvents: number
  upcomingPaidEvents: number
  paidOrdersLast30: number
  paidOrdersLast7: number
  paidOrdersPrevious7: number
}): RiskSignal {
  const hasPaidExposure =
    input.upcomingPaidEvents > 0 || input.paidOrdersLast30 > 0 || input.paidOrdersPrevious7 > 0

  if (!input.isStripeReady && hasPaidExposure) {
    return {
      value: "Payout setup needed",
      detail: "Connect Stripe to avoid payout friction on active paid momentum.",
      icon: <WalletCards className="size-3.5" />,
      emphasize: true,
    }
  }

  if (input.upcomingEvents === 0) {
    return {
      value: "No upcoming events scheduled",
      detail: "Queue your next release to keep your audience warm.",
      icon: <CalendarClock className="size-3.5" />,
      emphasize: true,
    }
  }

  if (input.upcomingPaidEvents === 0) {
    return {
      value: "No upcoming paid events",
      detail: "Your pipeline is active, but paid momentum may stall soon.",
      icon: <CalendarClock className="size-3.5" />,
      emphasize: true,
    }
  }

  if (input.paidOrdersLast30 === 0) {
    return {
      value: "No paid orders in 30 days",
      detail: "Refresh pricing, reminders, or promotion for your next paid event.",
      icon: <TrendingDown className="size-3.5" />,
      emphasize: true,
    }
  }

  if (input.paidOrdersPrevious7 > 0 && input.paidOrdersLast7 < input.paidOrdersPrevious7) {
    const delta = getPercentDelta(input.paidOrdersLast7, input.paidOrdersPrevious7)
    const dropText = delta !== null ? `${Math.abs(delta)}%` : "recently"
    return {
      value: `Paid momentum down ${dropText}`,
      detail: "Consider a fresh reminder push before your next event window.",
      icon: <TrendingDown className="size-3.5" />,
      emphasize: true,
    }
  }

  return {
    value: "Risk level is steady",
    detail: "No urgent payout, refund, or paid-momentum issues right now.",
    icon: <ShieldCheck className="size-3.5" />,
    emphasize: false,
  }
}

function buildOpportunitySignals(input: {
  paidOrdersLast30: number
  paidOrdersLast7: number
  paidOrdersPrevious7: number
  upcomingEvents: number
  upcomingPaidEvents: number
  primaryOrderCurrency: OrganizerOverviewSnapshot["grossBookedRevenueByCurrency"][number] | null
  primaryOrderCurrencyRevenueLast30: number
}): OpportunitySignal[] {
  const signals: OpportunitySignal[] = []
  const weekDelta = getPercentDelta(input.paidOrdersLast7, input.paidOrdersPrevious7)

  if (input.paidOrdersLast7 > 0 && input.paidOrdersPrevious7 > 0 && weekDelta !== null && weekDelta > 0) {
    signals.push({
      id: "momentum-up",
      value: `Momentum +${weekDelta}%`,
      detail: `${formatInteger(input.paidOrdersLast7)} paid orders this week vs ${formatInteger(input.paidOrdersPrevious7)} last week.`,
    })
  } else if (input.paidOrdersLast7 > 0 && input.paidOrdersPrevious7 === 0) {
    signals.push({
      id: "momentum-new",
      value: `${formatInteger(input.paidOrdersLast7)} paid orders this week`,
      detail: "You moved from zero last week to active paid traction.",
    })
  }

  if (input.primaryOrderCurrency) {
    const orderCount = `${formatInteger(input.primaryOrderCurrency.paidOrdersSucceeded)} paid ${
      input.primaryOrderCurrency.paidOrdersSucceeded === 1 ? "order" : "orders"
    }`
    signals.push({
      id: "primary-order-currency",
      value: `${input.primaryOrderCurrency.currency.toUpperCase()} - ${orderCount}`,
      detail: "Most paid orders currency to date.",
    })
  }

  if (input.primaryOrderCurrency && input.primaryOrderCurrencyRevenueLast30 > 0) {
    signals.push({
      id: "revenue-30d",
      value: formatRevenue(
        input.primaryOrderCurrencyRevenueLast30,
        input.primaryOrderCurrency.currency
      ),
      detail: "Booked in the last 30 days for your most paid orders currency.",
    })
  }

  if (input.upcomingPaidEvents > 0) {
    signals.push({
      id: "paid-pipeline",
      value: `${formatInteger(input.upcomingPaidEvents)} paid events ahead`,
      detail: "Prime your next conversion wave with reminders and promos.",
    })
  } else if (input.upcomingEvents > 0) {
    signals.push({
      id: "upgrade-pipeline",
      value: "Turn your next lineup into paid momentum",
      detail: "You have upcoming events. Consider pricing one to test demand.",
    })
  }

  if (input.paidOrdersLast30 > 0) {
    signals.push({
      id: "orders-30d",
      value: `${formatInteger(input.paidOrdersLast30)} paid orders in 30D`,
      detail: "Keep momentum by spotlighting your strongest upcoming event.",
    })
  }

  if (signals.length === 0) {
    return [
      {
        id: "launch-first-paid",
        value: "Launch your first paid event",
        detail: "Set ticket pricing and activate payouts to open a new revenue lane.",
      },
    ]
  }

  return signals.slice(0, 4)
}

function SignalCard({
  title,
  value,
  detail,
  icon,
  emphasize = false,
  footer,
}: {
  title: string
  value: string
  detail: string
  icon: ReactNode
  emphasize?: boolean
  footer?: ReactNode
}) {
  return (
    <article
      className={cn(
        "h-full rounded-xl border px-3 py-2.5 bg-clip-padding backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_20px_rgba(0,0,0,0.28)]",
        emphasize
          ? "border-amber-300/38 bg-amber-950/26"
          : "border-white/20 bg-zinc-950/60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">{title}</p>
        <span className="inline-flex size-6 items-center justify-center rounded-md border border-white/15 bg-black/24 text-zinc-200">
          {icon}
        </span>
      </div>
      <p className="mt-1 h-10 overflow-hidden text-sm font-semibold leading-5 text-white">
        {value}
      </p>
      <p className="mt-1 h-8 overflow-hidden text-[11px] leading-4 text-zinc-300">{detail}</p>
      <div className="mt-2 h-2.5">{footer}</div>
    </article>
  )
}

export default function OrganizerSignalDeck({
  refundCounts,
  overviewSnapshot,
  overviewTimeSeries,
  spotlightEvent,
  isStripeReady,
}: OrganizerSignalDeckProps) {
  const prefersReducedMotion = useReducedMotion()
  const { formatDate } = useViewerTz()
  const { open: openMenu } = useMenu()
  const [opportunityIndex, setOpportunityIndex] = useState(0)

  const primaryOrderCurrency = useMemo(
    () => selectMostPaidOrdersCurrency(overviewSnapshot.grossBookedRevenueByCurrency),
    [overviewSnapshot.grossBookedRevenueByCurrency]
  )
  const primaryOrderCurrencyCode = primaryOrderCurrency?.currency ?? null
  const spotlightLabel = spotlightEvent
    ? `${capitalizeFirstLetter(spotlightEvent.category)} - ${
        spotlightEvent.isPaid ? "Paid event" : "Free event"
      }`
    : "No spotlight event yet"

  const paidOrdersLast30 = useMemo(
    () => sumRecentPaidOrders(overviewTimeSeries.points, 30),
    [overviewTimeSeries.points]
  )
  const paidOrdersLast7 = useMemo(
    () => sumRecentPaidOrders(overviewTimeSeries.points, 7),
    [overviewTimeSeries.points]
  )
  const paidOrdersPrevious7 = useMemo(
    () => sumRecentPaidOrders(overviewTimeSeries.points, 7, 7),
    [overviewTimeSeries.points]
  )
  const primaryOrderCurrencyRevenueLast30 = useMemo(
    () => sumRecentRevenueForCurrency(overviewTimeSeries.points, 30, primaryOrderCurrencyCode),
    [overviewTimeSeries.points, primaryOrderCurrencyCode]
  )

  const riskSignal = useMemo(
    () =>
      buildRiskSignal({
        isStripeReady,
        upcomingEvents: overviewSnapshot.upcomingEvents,
        upcomingPaidEvents: overviewSnapshot.upcomingPaidEvents,
        paidOrdersLast30,
        paidOrdersLast7,
        paidOrdersPrevious7,
      }),
    [
      isStripeReady,
      overviewSnapshot.upcomingEvents,
      overviewSnapshot.upcomingPaidEvents,
      paidOrdersLast30,
      paidOrdersLast7,
      paidOrdersPrevious7,
    ]
  )

  const opportunitySignals = useMemo(
    () =>
      buildOpportunitySignals({
        paidOrdersLast30,
        paidOrdersLast7,
        paidOrdersPrevious7,
        upcomingEvents: overviewSnapshot.upcomingEvents,
        upcomingPaidEvents: overviewSnapshot.upcomingPaidEvents,
        primaryOrderCurrency,
        primaryOrderCurrencyRevenueLast30,
      }),
    [
      paidOrdersLast30,
      paidOrdersLast7,
      paidOrdersPrevious7,
      overviewSnapshot.upcomingEvents,
      overviewSnapshot.upcomingPaidEvents,
      primaryOrderCurrency,
      primaryOrderCurrencyRevenueLast30,
    ]
  )

  useEffect(() => {
    if (prefersReducedMotion || opportunitySignals.length <= 1) return

    const rotationTimer = window.setInterval(() => {
      setOpportunityIndex((current) => (current + 1) % opportunitySignals.length)
    }, 4200)

    return () => window.clearInterval(rotationTimer)
  }, [prefersReducedMotion, opportunitySignals.length])

  const normalizedOpportunityIndex =
    opportunitySignals.length > 0 ? opportunityIndex % opportunitySignals.length : 0
  const activeOpportunity =
    opportunitySignals[normalizedOpportunityIndex] ??
    opportunitySignals[0]

  return (
    <section className="relative isolate space-y-3 md:space-y-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-1 -inset-y-2 -z-10 rounded-[26px] bg-[radial-gradient(130%_110%_at_50%_0%,rgba(0,0,0,0.66)_0%,rgba(0,0,0,0.52)_46%,rgba(0,0,0,0.28)_100%)] md:-inset-x-3 md:-inset-y-3"
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <SignalCard
          title="Now"
          value={
            refundCounts.needsAttention > 0
              ? `${formatInteger(refundCounts.needsAttention)} refunds need review`
              : "Refund inbox clear"
          }
          detail="Handle active requests quickly to protect attendee trust."
          icon={<AlertTriangle className="size-3.5" />}
          emphasize={refundCounts.needsAttention > 0}
        />

        <SignalCard
          title="Next"
          value={`${formatInteger(overviewSnapshot.upcomingEvents)} upcoming events`}
          detail={
            overviewSnapshot.upcomingPaidEvents > 0
              ? `${formatInteger(overviewSnapshot.upcomingPaidEvents)} of them are paid opportunities.`
              : "Keep your next lineup visible and on track."
          }
          icon={<CalendarClock className="size-3.5" />}
        />

        <SignalCard
          title="Risk"
          value={riskSignal.value}
          detail={riskSignal.detail}
          icon={riskSignal.icon}
          emphasize={riskSignal.emphasize}
        />

        <SignalCard
          title="Opportunity"
          value={activeOpportunity?.value ?? "No opportunity signal yet"}
          detail={
            activeOpportunity?.detail ??
            "Create your next paid event to start building momentum."
          }
          icon={<Sparkles className="size-3.5" />}
          footer={
            opportunitySignals.length > 1 ? (
              <div className="mt-2 flex items-center gap-1.5" aria-label="Opportunity signals">
                {opportunitySignals.map((signal, index) => (
                  <span
                    key={signal.id}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-200",
                      index === normalizedOpportunityIndex
                        ? "w-4 bg-emerald-300/90"
                        : "w-1.5 bg-zinc-500/70"
                    )}
                  />
                ))}
              </div>
            ) : null
          }
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
        <article className="rounded-2xl border border-white/20 bg-zinc-950/62 p-4 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_26px_rgba(0,0,0,0.30)] md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400">Spotlight</p>
              <h3 className="text-base font-semibold text-white md:text-lg">{spotlightLabel}</h3>
            </div>

            <Link
              href="/events/new"
              className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
            >
              Create another
            </Link>
          </div>

          {spotlightEvent ? (
            <div className="mt-3 space-y-2.5">
              <p className="text-xl font-heading font-semibold text-white">
                {spotlightEvent.title}
              </p>
              <p className="text-xs text-zinc-300">
                {formatDate(spotlightEvent.date, spotlightEvent.eventTimeZone)}
              </p>
              <p className="text-xs text-zinc-400 line-clamp-2">{spotlightEvent.location}</p>

              <div className="pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    openMenu(spotlightEvent.id, { mode: "editable" })
                  }}
                  className="h-8 bg-emerald-800/90 text-xs text-white hover:bg-emerald-700/90"
                >
                  Open details
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-black/20 p-4 text-sm text-zinc-300">
              Your upcoming spotlight appears here once you have popular or scheduled events.
            </div>
          )}
        </article>

        <div className="space-y-3">
          <RefundsWidget counts={refundCounts} scope="organizer" />
          <OrganizerPaymentsWidget
            paidOrdersSucceeded={overviewSnapshot.paidOrdersSucceeded}
            grossRevenueByCurrency={overviewSnapshot.grossBookedRevenueByCurrency}
          />
        </div>
      </div>

      <OrganizerTrendCard snapshot={overviewTimeSeries} />
    </section>
  )
}
