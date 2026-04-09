"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import type { RefundViewerCounts } from "../types/refunds"
import { RefundsSummaryCard } from "./RefundsSummaryCard"
import { cn } from "@/lib/utils"

const RefundsWorkspace = dynamic(
  () =>
    import("../workspace/RefundsWorkspace").then(
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

interface RefundsWidgetProps {
  counts: RefundViewerCounts
  scope?: "admin" | "organizer"
}

export function RefundsWidget({
  counts: initialCounts,
  scope = "admin",
}: RefundsWidgetProps) {
  const [counts, setCounts] = useState<RefundViewerCounts>(initialCounts)
  const [open, setOpen] = useState(false)

  const hasAttention = counts.needsAttention > 0

  return (
    <Drawer open={open} onOpenChange={setOpen} direction="right">
      <RefundsSummaryCard
        counts={counts}
        reviewTrigger={
          <DrawerTrigger asChild className="">
            <Button
              type="button"
              size="sm"
              variant={hasAttention ? "default" : "secondary"}
              aria-label="Review refunds"
              className={cn(
                "h-9",
                hasAttention
                  ? "bg-amber-950/90 text-white hover:bg-amber-900/90"
                  : "border border-white/10 bg-white/[0.04] text-zinc-100 hover:bg-white/[0.08]"
              )
              }
            >
              <span>Review</span>
            </Button>
          </DrawerTrigger>
        }
      />

      <DrawerContent className="overflow-hidden border-white/10 bg-zinc-950 p-0 text-white data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:max-w-5xl data-[vaul-drawer-direction=right]:sm:max-w-5xl">
        <div className="sr-only">
          <DrawerTitle>Refunds workspace</DrawerTitle>
          <DrawerDescription>
            Review refund requests, inspect details, and issue manual refunds.
          </DrawerDescription>
        </div>

        {open && (
          <RefundsWorkspace initialCounts={counts} onCountsChange={setCounts} scope={scope} />
        )}
      </DrawerContent>
    </Drawer>
  )
}
