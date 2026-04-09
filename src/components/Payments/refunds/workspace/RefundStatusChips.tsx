"use client"

import type { RefundRequestListFilterStatus, RefundRequestListItem } from "../types/refunds"
import { cn } from "@/lib/utils"
import {
  Clock,
  Loader2,
  XCircle,
  Ban,
  CheckCircle2,
  CircleSlash,
} from "lucide-react"

type RefundStatusLike = RefundRequestListItem["status"]

const STATUS_CONFIG: Record<
  RefundStatusLike,
  {
    label: string
    icon: React.ElementType
    dotClass: string
    badgeClass: string
    activeClass: string
    activeCountClass: string
  }
> = {
  requested: {
    label: "Requested",
    icon: Clock,
    dotClass: "bg-amber-400",
    badgeClass: "bg-amber-500/15 text-amber-300",
    activeClass: "border-amber-700/60 bg-amber-950/60 text-amber-200",
    activeCountClass: "bg-amber-400/15 text-amber-100",
  },
  processing: {
    label: "Processing",
    icon: Loader2,
    dotClass: "bg-sky-400",
    badgeClass: "bg-sky-500/15 text-sky-300",
    activeClass: "border-sky-700/60 bg-sky-950/60 text-sky-200",
    activeCountClass: "bg-sky-400/15 text-sky-100",
  },
  approved: {
    label: "Approved",
    icon: Loader2,
    dotClass: "bg-sky-400",
    badgeClass: "bg-sky-500/15 text-sky-300",
    activeClass: "border-sky-700/60 bg-sky-950/60 text-sky-200",
    activeCountClass: "bg-sky-400/15 text-sky-100",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    dotClass: "bg-red-500",
    badgeClass: "bg-red-500/15 text-red-300",
    activeClass: "border-red-700/60 bg-red-950/60 text-red-200",
    activeCountClass: "bg-red-400/15 text-red-100",
  },
  rejected: {
    label: "Rejected",
    icon: Ban,
    dotClass: "bg-fuchsia-400",
    badgeClass: "bg-fuchsia-500/15 text-fuchsia-300",
    activeClass: "border-fuchsia-700/60 bg-fuchsia-950/60 text-fuchsia-200",
    activeCountClass: "bg-fuchsia-400/15 text-fuchsia-100",
  },
  succeeded: {
    label: "Succeeded",
    icon: CheckCircle2,
    dotClass: "bg-emerald-400",
    badgeClass: "bg-emerald-500/15 text-emerald-300",
    activeClass: "border-emerald-700/60 bg-emerald-950/60 text-emerald-200",
    activeCountClass: "bg-emerald-400/15 text-emerald-100",
  },
  canceled: {
    label: "Canceled",
    icon: CircleSlash,
    dotClass: "bg-zinc-400",
    badgeClass: "bg-muted text-muted-foreground",
    activeClass: "border-zinc-700/80 bg-zinc-900 text-zinc-200",
    activeCountClass: "bg-white/[0.08] text-zinc-100",
  },
}

const SERVER_FILTERS: { value: RefundRequestListFilterStatus; label: string }[] = [
  { value: "requested", label: "Requested" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "rejected", label: "Rejected" },
  { value: "succeeded", label: "Succeeded" },
]

interface RefundStatusChipsProps {
  activeFilter: RefundRequestListFilterStatus
  onFilterChange: (filter: RefundRequestListFilterStatus) => void
  counts: Record<string, number>
}

export function RefundStatusBadge({ status }: { status: RefundStatusLike }) {
  const config = STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
        config.badgeClass
      )}
    >
      <span className={cn("size-1.5 rounded-full", config.dotClass)} />
      {config.label}
    </span>
  )
}

export function RefundStatusChips({
  activeFilter,
  onFilterChange,
  counts,
}: RefundStatusChipsProps) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter refund status">
      {SERVER_FILTERS.map((filter) => {
        const count = counts[filter.value] ?? 0
        const isActive = activeFilter === filter.value
        const config = STATUS_CONFIG[filter.value]

        return (
          <button
            key={filter.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onFilterChange(filter.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
              "focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? config.activeClass
                : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/15 hover:bg-white/[0.06] hover:text-zinc-200"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full transition-colors",
                isActive ? config.dotClass : "bg-zinc-600"
              )}
            />
            {filter.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
                isActive
                  ? config.activeCountClass
                  : "bg-white/[0.06] text-zinc-400"
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export { SERVER_FILTERS }
