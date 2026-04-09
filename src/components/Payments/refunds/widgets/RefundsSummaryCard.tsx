"use client"

import type { ReactNode } from "react"
import type { RefundViewerCounts } from "../types/refunds"
import { cn } from "@/lib/utils"

interface RefundsSummaryCardProps {
  counts: RefundViewerCounts
  reviewTrigger: ReactNode
}

export function RefundsSummaryCard({
  counts,
  reviewTrigger,
}: RefundsSummaryCardProps) {
  const hasAttention = counts.needsAttention > 0

  return (
    <div
      className={cn(
        "w-full max-w-md rounded-2xl border px-3 py-3 md:px-4 md:mt-3",
        hasAttention
          ? "border-amber-400/30 bg-amber-950/30"
          : "border-white/10 bg-black/80"
      )}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-white">Refunds</h2>
              {hasAttention ? (
                <span className="rounded-full border border-amber-400/35 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-100">
                  {counts.needsAttention} need attention
                </span>
              ) : (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                  All caught up
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-300">
              {hasAttention
                ? "Pending requests are ready for review."
                : "No refunds currently require action."}
            </p>
          </div>

          <div className="shrink-0 self-end md:self-center">{reviewTrigger}</div>
        </div>
      </div>
    </div>
  )
}
