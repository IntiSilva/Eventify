"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import {
  ArrowRightLeft,
  CalendarClock,
  ReceiptText,
  Users2,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer"
import { cn } from "@/lib/utils"
import type {
  AdminOverviewSnapshot,
  AdminOverviewTimeSeriesSnapshot,
} from "@/lib/data"
import type { RefundViewerCounts } from "@/components/Payments/refunds/types/refunds"
import AdminOverviewTimeSeriesChart from "./AdminOverviewTimeSeriesChart"
import AnimatedCounter from "@/components/AnimatedText/AnimatedCounter"

const RefundsWorkspace = dynamic(
  () =>
    import("@/components/Payments/refunds/workspace/RefundsWorkspace").then(
      (module) => module.RefundsWorkspace
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[280px] items-center justify-center px-4 text-sm text-zinc-400">
        Loading refunds workspace...
      </div>
    ),
  }
)

const PaymentsWorkspace = dynamic(
  () =>
    import("@/components/Payments/payments/workspace/PaymentsWorkspace").then(
      (module) => module.PaymentsWorkspace
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[280px] items-center justify-center px-4 text-sm text-zinc-400">
        Loading payments workspace...
      </div>
    ),
  }
)

type AdminOverviewPanelProps = {
  snapshot: AdminOverviewSnapshot
  timeSeries: AdminOverviewTimeSeriesSnapshot
  organizersWithActiveEventsCount: number
  initialRefundCounts: RefundViewerCounts
}

type AdminWorkspaceKind = "refunds" | "payments"
type AdminWorkspaceDrawerDirection = "left" | "right"

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function placesFor(value: number): number[] {
  const normalized = Math.max(0, Math.floor(value))
  const length = String(normalized).length || 1
  return Array.from({ length }, (_, index) => 10 ** (length - index - 1))
}

function CounterSkeleton({ units }: { units: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: Math.max(1, units) }).map((_, index) => (
        <span
          key={index}
          className="animate-pulse rounded-sm bg-white/10"
          style={{ width: "0.85ch", height: "22px" }}
        />
      ))}
    </span>
  )
}

function AnimatedInteger({ value }: { value: number }) {
  const normalized = Math.max(0, Math.floor(value))
  const [showCounter, setShowCounter] = useState(false)
  const units = String(normalized).length || 1

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setShowCounter(true)
    })

    return () => cancelAnimationFrame(frame)
  }, [])

  if (!showCounter) {
    return <CounterSkeleton units={units} />
  }

  return (
    <AnimatedCounter
      value={normalized}
      places={placesFor(normalized)}
      fontSize={24}
      gradientFrom="transparent"
      gradientTo="transparent"
      gradientHeight={0}
      textColor="rgb(255 255 255)"
      fontWeight={600}
      horizontalPadding={0}
      gap={0}
      counterStyle={{ paddingLeft: 0, paddingRight: 0, gap: 0 }}
    />
  )
}

function MetricCard({
  label,
  value,
  icon: Icon,
  detail,
  emphasize = false,
}: {
  label: string
  value: number
  icon: LucideIcon
  detail: string
  emphasize?: boolean
}) {
  return (
    <Card
      className={cn(
        "h-full gap-0 border py-0 shadow-none",
        emphasize
          ? "border-amber-400/35 bg-gradient-to-b from-amber-900/25 to-amber-950/20"
          : "border-zinc-800/90 bg-gradient-to-b from-zinc-900/75 to-zinc-950/75"
      )}
    >
      <CardHeader className="px-3.5 pb-1 pt-3">
        <CardDescription className="text-[10px] uppercase tracking-wide text-zinc-500">
          {label}
        </CardDescription>
        <CardAction>
          <span className="inline-flex size-7 items-center justify-center rounded-md border border-white/10 bg-black/25">
            <Icon className="size-3.5 text-zinc-400" />
          </span>
        </CardAction>
        <CardTitle className="text-2xl font-semibold leading-tight tabular-nums text-white">
          <AnimatedInteger value={value} />
        </CardTitle>
      </CardHeader>
      <CardFooter className="border-t border-white/5 px-3.5 py-2">
        <p className="text-[11px] text-zinc-500">{detail}</p>
      </CardFooter>
    </Card>
  )
}

export default function AdminOverviewPanel({
  snapshot,
  timeSeries,
  organizersWithActiveEventsCount,
  initialRefundCounts,
}: AdminOverviewPanelProps) {
  const [refundCounts, setRefundCounts] =
    useState<RefundViewerCounts>(initialRefundCounts)
  const [activeWorkspace, setActiveWorkspace] =
    useState<AdminWorkspaceKind | null>(null)
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false)
  const [workspaceDrawerDirection, setWorkspaceDrawerDirection] =
    useState<AdminWorkspaceDrawerDirection>("right")

  const hasRefundAttention = refundCounts.needsAttention > 0
  const isRefundsWorkspace = activeWorkspace === "refunds"
  const isPaymentsWorkspace = activeWorkspace === "payments"

  const openWorkspace = (workspace: AdminWorkspaceKind) => {
    setActiveWorkspace(workspace)
    setWorkspaceDrawerDirection(workspace === "payments" ? "left" : "right")
    setIsWorkspaceOpen(true)
  }

  return (
    <section className="lg:px-12">
      <div className="rounded-xl border border-zinc-800/90 bg-black/55 p-3.5 md:p-4">
        <div className="flex flex-col gap-1.5">
          <div>
            <h2 className="text-sm font-semibold text-white md:text-[15px]">
              Admin overview
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Snapshot from persisted application data for operational oversight.
            </p>
          </div>
        </div>

        <Drawer
          open={isWorkspaceOpen}
          onOpenChange={(open) => {
            setIsWorkspaceOpen(open)
            if (!open) {
              setActiveWorkspace(null)
            }
          }}
          direction={workspaceDrawerDirection}
        >
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Organizers with active events"
              value={organizersWithActiveEventsCount}
              icon={Users2}
              detail="Organizers with at least one future non-archived event."
            />
            <MetricCard
              label="Upcoming events"
              value={snapshot.upcomingActiveEvents}
              icon={CalendarClock}
              detail="Future-dated active events."
            />

            <Card className="h-full gap-0 border border-zinc-800/90 bg-gradient-to-b from-zinc-900/75 to-zinc-950/75 py-0 shadow-none">
              <CardHeader className="px-3.5 pb-1 pt-3">
                <CardDescription className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Paid orders (succeeded)
                </CardDescription>
                <CardAction>
                  <span className="inline-flex size-7 items-center justify-center rounded-md border border-white/10 bg-black/25">
                    <ReceiptText className="size-3.5 text-zinc-400" />
                  </span>
                </CardAction>
                <CardTitle className="text-2xl font-semibold leading-tight tabular-nums text-white">
                  <AnimatedInteger value={snapshot.paidOrdersSucceeded} />
                </CardTitle>
              </CardHeader>

              <CardFooter className="border-t border-white/5 px-3.5 py-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => openWorkspace("payments")}
                  className="h-8 w-full justify-center gap-2 border border-white/10 bg-white/[0.04] text-xs text-zinc-100 hover:bg-white/[0.08]"
                >
                  <ReceiptText className="size-3.5" />
                  Open payments
                </Button>
              </CardFooter>
            </Card>

            <Card
              className={cn(
                "h-full gap-0 border py-0 shadow-none",
                hasRefundAttention
                  ? "border-amber-400/35 bg-gradient-to-b from-amber-900/25 to-amber-950/20"
                  : "border-zinc-800/90 bg-gradient-to-b from-zinc-900/75 to-zinc-950/75"
              )}
            >
              <CardHeader className="px-3.5 pb-1 pt-3">
                <CardDescription className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Refund inbox
                </CardDescription>
                <CardAction>
                  {hasRefundAttention ? (
                    <span className="inline-flex items-center rounded-md border border-amber-300/40 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">
                      {formatInteger(refundCounts.needsAttention)} pending
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md border border-emerald-300/35 bg-emerald-900/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100">
                      Clear
                    </span>
                  )}
                </CardAction>
                <CardTitle className="text-2xl font-semibold leading-tight tabular-nums text-white">
                  <AnimatedInteger value={refundCounts.needsAttention} />
                </CardTitle>
              </CardHeader>

              <CardFooter className="border-t border-white/5 px-3.5 py-2">
                <Button
                  type="button"
                  size="sm"
                  variant={hasRefundAttention ? "default" : "secondary"}
                  onClick={() => openWorkspace("refunds")}
                  className={cn(
                    "h-8 w-full justify-center gap-2 text-xs",
                    hasRefundAttention
                      ? "bg-amber-950/90 text-white hover:bg-amber-900/90"
                      : "border border-white/10 bg-white/[0.04] text-zinc-100 hover:bg-white/[0.08]"
                  )}
                >
                  <ArrowRightLeft className="size-3.5" />
                  Open refunds
                </Button>
              </CardFooter>
            </Card>
          </div>

          <DrawerContent className="overflow-hidden border-white/10 bg-zinc-950 p-0 text-white data-[vaul-drawer-direction=right]:h-[100dvh] data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:max-w-5xl data-[vaul-drawer-direction=right]:sm:max-w-5xl data-[vaul-drawer-direction=left]:h-[100dvh] data-[vaul-drawer-direction=left]:w-full data-[vaul-drawer-direction=left]:max-w-5xl data-[vaul-drawer-direction=left]:sm:max-w-5xl">
            <div className="sr-only">
              <DrawerTitle>
                {isRefundsWorkspace ? "Admin refunds workspace" : "Admin payments workspace"}
              </DrawerTitle>
              <DrawerDescription>
                {isRefundsWorkspace
                  ? "Review refund requests with buyer, organizer, event, and status context."
                  : "Inspect paid-event payments across statuses with buyer, owner, payout, and refund relation context."}
              </DrawerDescription>
            </div>

            <div className="flex h-full min-h-0 flex-col">
              {isRefundsWorkspace ? (
                <RefundsWorkspace
                  initialCounts={refundCounts}
                  onCountsChange={setRefundCounts}
                />
              ) : null}

              {isPaymentsWorkspace ? <PaymentsWorkspace /> : null}
            </div>
          </DrawerContent>
        </Drawer>

        <AdminOverviewTimeSeriesChart snapshot={timeSeries} />
      </div>
    </section>
  )
}
