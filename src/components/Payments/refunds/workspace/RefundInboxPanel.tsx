"use client"

import type { ReactNode } from "react"
import type {
  RefundRequestListFilterPayoutTarget,
  RefundRequestListFilterSource,
  RefundRequestListFilterStatus,
  RefundRequestListItem,
} from "../types/refunds"
import { RefundStatusChips } from "./RefundStatusChips"
import { RefundRequestRow, RefundRequestRowSkeleton } from "./RefundRequestRow"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RefreshCw, Inbox } from "lucide-react"
import { cn } from "@/lib/utils"

interface RefundInboxPanelProps {
  items: RefundRequestListItem[]
  counts: Record<string, number>
  scope?: "admin" | "organizer"
  selectedId: string | null
  selectedStatus: RefundRequestListFilterStatus
  searchValue: string
  sourceFilter: RefundRequestListFilterSource
  payoutTargetFilter: RefundRequestListFilterPayoutTarget
  onSelect: (refundRequestId: string) => void
  onStatusChange: (status: RefundRequestListFilterStatus) => void
  onSearchChange: (value: string) => void
  onSourceFilterChange: (source: RefundRequestListFilterSource) => void
  onPayoutTargetFilterChange: (
    payoutTarget: RefundRequestListFilterPayoutTarget
  ) => void
  onRefresh: () => void
  onLoadMore?: () => void
  hasMore?: boolean
  isLoading?: boolean
  isLoadingMore?: boolean
  error?: string | null
  footer?: ReactNode
  contentPaddingBottomClassName?: string
}

const SCROLLBAR_CLASSES = cn(
  "[&::-webkit-scrollbar]:w-1",
  "[&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:rounded-full",
  "[&::-webkit-scrollbar-thumb]:bg-rose-900",
  "[&::-webkit-scrollbar-thumb:hover]:bg-rose-600",
  "[&::-webkit-scrollbar-thumb:hover]:cursor-pointer"
)

export function RefundInboxPanel({
  items = [],
  counts,
  scope = "admin",
  selectedId,
  selectedStatus,
  searchValue,
  sourceFilter,
  payoutTargetFilter,
  onSelect,
  onStatusChange,
  onSearchChange,
  onSourceFilterChange,
  onPayoutTargetFilterChange,
  onRefresh,
  onLoadMore,
  hasMore = false,
  isLoading = false,
  isLoadingMore = false,
  error = null,
  footer,
  contentPaddingBottomClassName
}: RefundInboxPanelProps) {
  const isOrganizerScope = scope === "organizer"
  const showLoadingSkeleton = isLoading && items.length === 0
  const showLoadMore = items.length > 0 && hasMore && typeof onLoadMore === "function"

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 flex flex-col gap-2.5 border-b border-border/50">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            Refund Inbox
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full border border-rose-900/45 bg-zinc-900/60 text-rose-300 hover:bg-rose-950/25 hover:text-rose-200"
            onClick={onRefresh}
            aria-label="Refresh refunds"
            disabled={isLoading}
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                isLoading && "animate-spin"
              )}
            />
          </Button>
        </div>
        <RefundStatusChips
          activeFilter={selectedStatus}
          onFilterChange={onStatusChange}
          counts={counts}
        />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={
            isOrganizerScope
              ? "Search buyer, event..."
              : "Search buyer, counterparty, event..."
          }
          className="h-8 border-zinc-800 bg-black/40 text-xs text-zinc-100 placeholder:text-zinc-500"
        />
        <div className={cn("grid gap-2", isOrganizerScope ? "grid-cols-1" : "grid-cols-2")}>
          <Select
            value={sourceFilter}
            onValueChange={(value) =>
              onSourceFilterChange(value as RefundRequestListFilterSource)
            }
          >
            <SelectTrigger className="h-8 border-zinc-800 bg-black/40 text-xs text-zinc-200">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
              <SelectItem value="all" className="text-xs">All sources</SelectItem>
              <SelectItem value="user_request" className="text-xs">User requests</SelectItem>
              <SelectItem value="manual_override" className="text-xs">Manual overrides</SelectItem>
              <SelectItem value="system_compensation" className="text-xs">System compensation</SelectItem>
            </SelectContent>
          </Select>

          {!isOrganizerScope ? (
            <Select
              value={payoutTargetFilter}
              onValueChange={(value) =>
                onPayoutTargetFilterChange(
                  value as RefundRequestListFilterPayoutTarget
                )
              }
            >
              <SelectTrigger className="h-8 border-zinc-800 bg-black/40 text-xs text-zinc-200">
                <SelectValue placeholder="Payout" />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
                <SelectItem value="all" className="text-xs">All payouts</SelectItem>
                <SelectItem value="organizer" className="text-xs">Organizer payouts</SelectItem>
                <SelectItem value="platform" className="text-xs">Platform payouts</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "flex-1 overflow-y-auto overscroll-contain",
          SCROLLBAR_CLASSES,
          contentPaddingBottomClassName
        )}
      >
        {showLoadingSkeleton ? (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <RefundRequestRowSkeleton key={i} />
            ))}
          </div>
        ) : error != null ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 gap-2">
            <p className="text-xs text-white text-center">{error}</p>
            <Button size="sm" variant="outline" onClick={onRefresh}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 gap-2">
            <div className="rounded-full bg-zinc-900 p-2.5">
              <Inbox className="size-4 text-rose-600" />
            </div>
            <p className="text-xs text-white text-center">
              No refund requests
              <span className="font-medium text-zinc-400"> with status {selectedStatus}</span>
            </p>
          </div>
        ) : (
          <div>
            {items.map((item) => (
              <RefundRequestRow
                key={item.refundRequestId}
                request={item}
                scope={scope}
                isSelected={item.refundRequestId === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}

        {showLoadMore ? (
          <div className="px-3 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full border-zinc-700 bg-zinc-900/70 text-zinc-200 hover:bg-zinc-800"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? "Loading more..." : "Load more"}
            </Button>
          </div>
        ) : null}

        {footer}
      </div>
    </div>
  )
}
