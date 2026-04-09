"use client"

import { Inbox, RefreshCw, Search, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type {
  AdminPaymentCurrencyFilter,
  AdminPaymentListItem,
  AdminPaymentPayoutTargetFilter,
  AdminPaymentStatusFilter,
  AdminPaymentRefundStateFilter,
} from "../types/payments"
import { PaymentRow, PaymentRowSkeleton } from "./PaymentRow"

interface PaymentInboxPanelProps {
  items: AdminPaymentListItem[]
  selectedId: string | null
  scope?: "admin" | "organizer"
  searchValue: string
  paymentStatus: AdminPaymentStatusFilter
  currency: AdminPaymentCurrencyFilter
  availableCurrencies: string[]
  refundState: AdminPaymentRefundStateFilter
  payoutTarget: AdminPaymentPayoutTargetFilter
  onSelect: (paymentId: string) => void
  onSearchChange: (value: string) => void
  onPaymentStatusChange: (value: AdminPaymentStatusFilter) => void
  onCurrencyChange: (value: AdminPaymentCurrencyFilter) => void
  onRefundStateChange: (value: AdminPaymentRefundStateFilter) => void
  onPayoutTargetChange: (value: AdminPaymentPayoutTargetFilter) => void
  onRefresh: () => void
  onLoadMore?: () => void
  hasMore?: boolean
  isLoading?: boolean
  isLoadingMore?: boolean
  error?: string | null
  contentPaddingBottomClassName?: string
}

const REFUND_STATE_OPTIONS: {
  value: AdminPaymentRefundStateFilter
  label: string
}[] = [
  { value: "all", label: "All refund states" },
  { value: "no_refund", label: "No refund" },
  { value: "requested", label: "Refund requested" },
  { value: "processing", label: "Refund processing" },
  { value: "failed", label: "Refund failed" },
  { value: "rejected", label: "Refund rejected" },
  { value: "succeeded", label: "Refund succeeded" },
  { value: "canceled", label: "Refund canceled" },
]

const PAYMENT_STATUS_OPTIONS: {
  value: AdminPaymentStatusFilter
  label: string
}[] = [
  { value: "all", label: "All payment statuses" },
  { value: "pending", label: "Pending" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
]

const PAYOUT_TARGET_OPTIONS: {
  value: AdminPaymentPayoutTargetFilter
  label: string
}[] = [
  { value: "all", label: "All payouts" },
  { value: "organizer", label: "Organizer payouts" },
  { value: "platform", label: "Platform payouts" },
]

const SCROLLBAR_CLASSES = cn(
  "[&::-webkit-scrollbar]:w-1",
  "[&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:rounded-full",
  "[&::-webkit-scrollbar-thumb]:bg-emerald-900",
  "[&::-webkit-scrollbar-thumb:hover]:bg-emerald-600",
  "[&::-webkit-scrollbar-thumb:hover]:cursor-pointer"
)

function getOptionLabel<TValue extends string>(
  options: { value: TValue; label: string }[],
  value: TValue
): string {
  return options.find((option) => option.value === value)?.label ?? value
}

export function PaymentInboxPanel({
  items,
  selectedId,
  scope = "admin",
  searchValue,
  paymentStatus,
  currency,
  availableCurrencies,
  refundState,
  payoutTarget,
  onSelect,
  onSearchChange,
  onPaymentStatusChange,
  onCurrencyChange,
  onRefundStateChange,
  onPayoutTargetChange,
  onRefresh,
  onLoadMore,
  hasMore = false,
  isLoading = false,
  isLoadingMore = false,
  error = null,
  contentPaddingBottomClassName,
}: PaymentInboxPanelProps) {
  const isOrganizerScope = scope === "organizer"
  const showLoadingSkeleton = isLoading && items.length === 0
  const showLoadMore = items.length > 0 && hasMore && typeof onLoadMore === "function"
  const currencyOptions =
    currency !== "all" && !availableCurrencies.includes(currency)
      ? [currency, ...availableCurrencies]
      : availableCurrencies
  const paymentStatusLabel = getOptionLabel(PAYMENT_STATUS_OPTIONS, paymentStatus)
  const refundStateLabel = getOptionLabel(REFUND_STATE_OPTIONS, refundState)
  const payoutTargetLabel = getOptionLabel(PAYOUT_TARGET_OPTIONS, payoutTarget)
  const secondaryActiveCount =
    Number(refundState !== "all") + Number(!isOrganizerScope && payoutTarget !== "all")
  const activeFilterChips = [
    paymentStatus !== "all" ? paymentStatusLabel : null,
    currency !== "all" ? currency.toUpperCase() : null,
    refundState !== "all" ? refundStateLabel : null,
    !isOrganizerScope && payoutTarget !== "all" ? payoutTargetLabel : null,
  ].filter((value): value is string => Boolean(value))

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2.5 border-b border-border/50 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-sm font-semibold text-white">Payments Inbox</h2>
          <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Control rail</span>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={
              isOrganizerScope
                ? "Search payment, buyer, event..."
                : "Search payment, buyer, owner, event..."
            }
            className="h-8 rounded-full border-zinc-800/90 bg-black/45 pr-2 pl-8 text-xs text-zinc-100 placeholder:text-zinc-500"
          />
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/75 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={paymentStatus}
              onValueChange={(value) => onPaymentStatusChange(value as AdminPaymentStatusFilter)}
            >
              <SelectTrigger className="h-8 min-w-[150px] flex-1 rounded-full border-zinc-800 bg-zinc-900/70 text-[11px] font-medium text-zinc-100 sm:flex-none">
                <SelectValue placeholder="Payment status" />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
                {PAYMENT_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={currency} onValueChange={onCurrencyChange}>
              <SelectTrigger className="h-8 min-w-[128px] flex-1 rounded-full border-zinc-800 bg-zinc-900/70 text-[11px] font-medium text-zinc-100 sm:flex-none">
                <SelectValue
                  placeholder="Currency"
                  className={cn(currency !== "all" && "uppercase")}
                />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
                <SelectItem value="all" className="text-xs">
                  All currencies
                </SelectItem>
                {currencyOptions.map((currencyCode) => (
                  <SelectItem key={currencyCode} value={currencyCode} className="text-xs uppercase">
                    {currencyCode.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex w-full items-center justify-between sm:ml-auto sm:gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full border-zinc-800 bg-zinc-900/70 px-3 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800/80 hover:text-zinc-100"
                  >
                    <SlidersHorizontal className="mr-1.5 size-3.5" />
                    Filters
                    {secondaryActiveCount > 0 ? (
                      <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] leading-none text-emerald-200">
                        {secondaryActiveCount}
                      </span>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={8}
                  className="w-[260px] border-zinc-700 bg-zinc-950/95 p-3 text-zinc-100 shadow-2xl shadow-black/45"
                >
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Refund state</p>
                      <Select
                        value={refundState}
                        onValueChange={(value) =>
                          onRefundStateChange(value as AdminPaymentRefundStateFilter)
                        }
                      >
                        <SelectTrigger className="h-8 border-zinc-800 bg-black/40 text-xs text-zinc-200">
                          <SelectValue placeholder="Refund state" />
                        </SelectTrigger>
                        <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
                          {REFUND_STATE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value} className="text-xs">
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {!isOrganizerScope ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Payout target</p>
                        <Select
                          value={payoutTarget}
                          onValueChange={(value) =>
                            onPayoutTargetChange(value as AdminPaymentPayoutTargetFilter)
                          }
                        >
                          <SelectTrigger className="h-8 border-zinc-800 bg-black/40 text-xs text-zinc-200">
                            <SelectValue placeholder="Payout target" />
                          </SelectTrigger>
                          <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
                            {PAYOUT_TARGET_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value} className="text-xs">
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full border border-emerald-900/45 bg-zinc-900/60 text-emerald-300 hover:bg-emerald-950/25 hover:text-emerald-200"
                onClick={onRefresh}
                aria-label="Refresh payments"
                disabled={isLoading}
              >
                <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {activeFilterChips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeFilterChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-zinc-800/90 bg-zinc-900/80 px-2 py-0.5 text-[10px] text-zinc-300"
                >
                  {chip}
                </span>
              ))}
            </div>
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
            {Array.from({ length: 6 }).map((_, index) => (
              <PaymentRowSkeleton key={index} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12">
            <p className="text-center text-xs text-white">{error}</p>
            <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12">
            <div className="rounded-full bg-zinc-900 p-2.5">
              <Inbox className="size-4 text-emerald-600" />
            </div>
            <p className="text-center text-xs text-white">No payments found.</p>
          </div>
        ) : (
          <div>
            {items.map((item) => (
              <PaymentRow
                key={item.paymentId}
                payment={item}
                scope={scope}
                isSelected={item.paymentId === selectedId}
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
      </div>
    </div>
  )
}
