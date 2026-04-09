"use client"

import dynamic from "next/dynamic"
import { useMemo, useState } from "react"
import { ReceiptText } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import type { OrganizerOverviewGrossRevenueByCurrency } from "@/lib/data"
import { cn } from "@/lib/utils"

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

interface OrganizerPaymentsWidgetProps {
  paidOrdersSucceeded: number
  grossRevenueByCurrency: OrganizerOverviewGrossRevenueByCurrency[]
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function selectMostPaidOrdersCurrency(
  rows: OrganizerOverviewGrossRevenueByCurrency[]
): OrganizerOverviewGrossRevenueByCurrency | null {
  if (rows.length === 0) return null

  return rows.reduce((best, row) => {
    if (row.paidOrdersSucceeded > best.paidOrdersSucceeded) return row
    if (row.paidOrdersSucceeded < best.paidOrdersSucceeded) return best
    if (row.amountCents > best.amountCents) return row
    if (row.amountCents < best.amountCents) return best
    return row.currency.localeCompare(best.currency) < 0 ? row : best
  }, rows[0])
}

function formatMostPaidOrdersCurrency(
  row: OrganizerOverviewGrossRevenueByCurrency | null
): string {
  if (!row || row.paidOrdersSucceeded <= 0) return "No paid orders yet"
  const countLabel = `${formatInteger(row.paidOrdersSucceeded)} ${
    row.paidOrdersSucceeded === 1 ? "order" : "orders"
  }`
  return `${row.currency.toUpperCase()} (${countLabel})`
}

export function OrganizerPaymentsWidget({
  paidOrdersSucceeded,
  grossRevenueByCurrency,
}: OrganizerPaymentsWidgetProps) {
  const [open, setOpen] = useState(false)

  const mostPaidOrdersCurrency = useMemo(
    () => selectMostPaidOrdersCurrency(grossRevenueByCurrency),
    [grossRevenueByCurrency]
  )
  const hasPaidOrders = paidOrdersSucceeded > 0

  return (
    <Drawer open={open} onOpenChange={setOpen} direction="left">
      <div
        className={cn(
          "w-full rounded-2xl border px-3 py-3 bg-clip-padding backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_24px_rgba(0,0,0,0.30)] md:px-4",
          hasPaidOrders
            ? "border-emerald-300/38 bg-emerald-950/34"
            : "border-white/20 bg-zinc-950/60"
        )}
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex size-7 items-center justify-center rounded-md border border-white/15 bg-black/24">
                  <ReceiptText className="size-3.5 text-zinc-300" />
                </span>
                <h3 className="text-sm font-semibold text-white">Payments</h3>
              </div>
              <p className="mt-1 text-xs text-zinc-300">
                {formatInteger(paidOrdersSucceeded)} paid orders succeeded
              </p>
              <p className="mt-1 text-xs text-zinc-300">
                Most paid orders currency:{" "}
                {formatMostPaidOrdersCurrency(mostPaidOrdersCurrency)}
              </p>
            </div>

            <DrawerTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant={hasPaidOrders ? "default" : "secondary"}
                className={cn(
                  "h-8 shrink-0 text-xs",
                  hasPaidOrders
                    ? "bg-emerald-800/90 text-white hover:bg-emerald-700/90"
                    : "border border-white/10 bg-white/[0.04] text-zinc-100 hover:bg-white/[0.08]"
                )}
              >
                Open
              </Button>
            </DrawerTrigger>
          </div>
        </div>
      </div>

      <DrawerContent className="overflow-hidden border-white/10 bg-zinc-950 p-0 text-white data-[vaul-drawer-direction=left]:h-[100dvh] data-[vaul-drawer-direction=left]:w-full data-[vaul-drawer-direction=left]:max-w-5xl data-[vaul-drawer-direction=left]:sm:max-w-5xl">
        <div className="sr-only">
          <DrawerTitle>Organizer payments workspace</DrawerTitle>
          <DrawerDescription>
            Inspect payments for your events with payout and refund context.
          </DrawerDescription>
        </div>

        {open ? <PaymentsWorkspace scope="organizer" /> : null}
      </DrawerContent>
    </Drawer>
  )
}
