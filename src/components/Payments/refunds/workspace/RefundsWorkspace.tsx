"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { ChevronLeft, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import {
  approveRefund,
  forceRefundByPayment,
  getRefundCountsForViewer,
  listRefundRequestsForViewer,
  rejectRefund,
} from "@/app/(dashboard)/rsvp/actions"
import { Button } from "@/components/ui/button"
import { DrawerClose } from "@/components/ui/drawer"
import { useMediaQuery } from "@/lib/hooks"
import { toast } from "sonner"
import type {
  RefundRequestListFilterPayoutTarget,
  RefundRequestListFilterSource,
  RefundRequestListFilterStatus,
  RefundRequestListItem,
  RefundViewerCounts,
} from "../types/refunds"
import { RefundInboxPanel } from "./RefundInboxPanel"
import { RefundDetailsPane } from "./RefundDetailsPane"
import { ManualRefundTool } from "./ManualRefundTool"

const DEFAULT_REFUNDS_LIST_LIMIT = 30
const REFUNDS_LIST_LOAD_MORE_STEP = 20
const REFUNDS_SEARCH_DEBOUNCE_MS = 250

type RefundsWorkspaceScope = "admin" | "organizer"

interface RefundsWorkspaceProps {
  initialCounts: RefundViewerCounts
  onCountsChange?: (counts: RefundViewerCounts) => void
  scope?: RefundsWorkspaceScope
}

export function RefundsWorkspace({
  initialCounts,
  onCountsChange,
  scope = "admin",
}: RefundsWorkspaceProps) {
  const isOrganizerScope = scope === "organizer"
  const [selectedStatus, setSelectedStatus] =
    useState<RefundRequestListFilterStatus>("requested")
  const [sourceFilter, setSourceFilter] =
    useState<RefundRequestListFilterSource>("all")
  const [payoutTargetFilter, setPayoutTargetFilter] =
    useState<RefundRequestListFilterPayoutTarget>("all")
  const [searchDraft, setSearchDraft] = useState("")
  const [searchTerm, setSearchTerm] = useState<string | null>(null)
  const [listLimit, setListLimit] = useState(DEFAULT_REFUNDS_LIST_LIMIT)
  const [items, setItems] = useState<RefundRequestListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [counts, setCounts] = useState<RefundViewerCounts>(initialCounts)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeActionId, setActiveActionId] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [isPending, startTransition] = useTransition()
  const isDesktop = useMediaQuery("(min-width: 768px)")

  const isMountedRef = useRef(true)
  const isDesktopRef = useRef(isDesktop)
  const requestIdRef = useRef(0)
  const includeCountsNextLoadRef = useRef(false)
  const showLoadToastNextLoadRef = useRef(false)
  const softLoadNextLoadRef = useRef(false)
  const onCountsChangeRef = useRef(onCountsChange)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    onCountsChangeRef.current = onCountsChange
  }, [onCountsChange])

  useEffect(() => {
    isDesktopRef.current = isDesktop
  }, [isDesktop])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalized = searchDraft.trim()
      setSearchTerm(normalized.length > 0 ? normalized : null)
    }, REFUNDS_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [searchDraft])

  useEffect(() => {
    setListLimit((current) =>
      current === DEFAULT_REFUNDS_LIST_LIMIT
        ? current
        : DEFAULT_REFUNDS_LIST_LIMIT
    )
  }, [searchTerm])

  useEffect(() => {
    const reqId = ++requestIdRef.current
    const includeCounts = includeCountsNextLoadRef.current
    const showErrorToast = showLoadToastNextLoadRef.current
    const softLoad = softLoadNextLoadRef.current
    includeCountsNextLoadRef.current = false
    showLoadToastNextLoadRef.current = false
    softLoadNextLoadRef.current = false

    async function run() {
      const status = selectedStatus
      const source = sourceFilter
      const payoutTarget = isOrganizerScope ? "all" : payoutTargetFilter
      const search = searchTerm

      if (softLoad) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setError(null)
      }

      if (process.env.NODE_ENV !== "production") {
        console.log("[refunds] fetch list start", {
          status,
          source,
          payoutTarget,
          search,
          limit: listLimit,
          softLoad,
        })
      }

      try {
        if (includeCounts) {
          try {
            const countsResult = await getRefundCountsForViewer()

            if (reqId !== requestIdRef.current) return

            if (countsResult.success) {
              setCounts(countsResult.data)
              onCountsChangeRef.current?.(countsResult.data)
            } else if (showErrorToast) {
              toast.error(countsResult.message)
            }
          } catch (countsError) {
            if (reqId !== requestIdRef.current) return

            if (showErrorToast) {
              toast.error(
                countsError instanceof Error && countsError.message.trim().length > 0
                  ? countsError.message
                  : "Could not load refund counts."
              )
            }
          }
        }

        const res = await listRefundRequestsForViewer({
          status,
          source,
          payoutTarget,
          search: search ?? undefined,
          limit: listLimit,
        })

        if (reqId !== requestIdRef.current) return

        if (!res.success) {
          throw new Error(res.message ?? "Could not load refund requests")
        }

        if (!Array.isArray(res.data)) {
          const message =
            "Unexpected response shape from listRefundRequestsForViewer"
          if (!softLoad) {
            setItems([])
            setSelectedId(null)
            setError(message)
          }

          if (process.env.NODE_ENV !== "production") {
            console.log("[refunds] fetch list error", {
              status,
              source,
              payoutTarget,
              search,
              limit: listLimit,
              error: message,
            })
          }

          if (showErrorToast) {
            toast.error(message)
          }

          return
        }

        setItems(res.data)
        setHasMore(res.hasMore === true)
        setSelectedId((current) => {
          if (current && res.data.some((item) => item.refundRequestId === current)) {
            return current
          }

          if (!isDesktopRef.current) {
            return null
          }

          return res.data[0]?.refundRequestId ?? null
        })

        if (process.env.NODE_ENV !== "production") {
          console.log("[refunds] fetch list done", {
            status,
            source,
            payoutTarget,
            search,
            limit: listLimit,
            success: res.success,
            itemsLen: res.data.length,
            hasMore: res.hasMore,
          })
        }
      } catch (loadError) {
        if (reqId !== requestIdRef.current) return

        const message =
          loadError instanceof Error && loadError.message.trim().length > 0
            ? loadError.message
            : "Could not load refund requests"

        if (softLoad) {
          toast.error(message)
        } else {
          setItems([])
          setHasMore(false)
          setSelectedId(null)
          setError(message)
        }

        if (process.env.NODE_ENV !== "production") {
          console.log("[refunds] fetch list error", {
            status,
            source,
            payoutTarget,
            search,
            limit: listLimit,
            softLoad,
            error: message,
          })
        }

        if (!softLoad && showErrorToast) {
          toast.error(message)
        }
      } finally {
        if (reqId === requestIdRef.current) {
          setIsLoading(false)
          setIsLoadingMore(false)
        }
      }
    }

    void run()
  }, [
    refreshVersion,
    selectedStatus,
    sourceFilter,
    payoutTargetFilter,
    searchTerm,
    listLimit,
    isOrganizerScope,
  ])

  const selectedItem = useMemo(
    () => items.find((item) => item.refundRequestId === selectedId) ?? null,
    [items, selectedId]
  )

  const requestReload = (options?: {
    includeCounts?: boolean
    showErrorToast?: boolean
    softLoad?: boolean
  }) => {
    includeCountsNextLoadRef.current = options?.includeCounts ?? true
    showLoadToastNextLoadRef.current = options?.showErrorToast ?? false
    softLoadNextLoadRef.current = options?.softLoad ?? false
    setRefreshVersion((current) => current + 1)
  }

  const handleStatusChange = (status: RefundRequestListFilterStatus) => {
    setSelectedStatus(status)
    setListLimit(DEFAULT_REFUNDS_LIST_LIMIT)
  }

  const handleSourceFilterChange = (source: RefundRequestListFilterSource) => {
    setSourceFilter(source)
    setListLimit(DEFAULT_REFUNDS_LIST_LIMIT)
  }

  const handlePayoutTargetFilterChange = (
    payoutTarget: RefundRequestListFilterPayoutTarget
  ) => {
    setPayoutTargetFilter(payoutTarget)
    setListLimit(DEFAULT_REFUNDS_LIST_LIMIT)
  }

  const handleLoadMore = () => {
    if (hasMore !== true || isLoading || isLoadingMore) return

    softLoadNextLoadRef.current = true
    showLoadToastNextLoadRef.current = true
    includeCountsNextLoadRef.current = false
    setListLimit((current) => Math.min(100, current + REFUNDS_LIST_LOAD_MORE_STEP))
  }

  const runAction = (
    actionId: string,
    task: () => Promise<{ success: boolean; message: string; data: unknown }>
  ) => {
    setActiveActionId(actionId)

    return new Promise<boolean>((resolve) => {
      startTransition(() => {
        void (async () => {
          const result = await task()

          if (result.success) {
            toast.success(result.message)
          } else {
            toast.error(result.message)
          }

          requestReload({ includeCounts: true })

          if (isMountedRef.current) {
            setActiveActionId(null)
          }

          resolve(result.success)
        })()
      })
    })
  }

  const handleApprove = (refundRequestId: string) =>
    runAction(refundRequestId, () => approveRefund(refundRequestId))

  const handleReject = (refundRequestId: string, note?: string | null) =>
    runAction(refundRequestId, () => rejectRefund(refundRequestId, note ?? null))

  const handleManualRefund = (paymentId: string, note?: string | null) =>
    runAction("manual-refund", () => forceRefundByPayment(paymentId, note ?? null))

  const selectedItemPending =
    isPending &&
    Boolean(selectedItem) &&
    activeActionId === selectedItem?.refundRequestId
  const showDebug = process.env.NEXT_PUBLIC_REFUNDS_DEBUG === "1"
  const showMobileDetails = !isDesktop && selectedItem !== null
  const mobileTransition = {
    duration: 0.18,
    ease: "easeOut" as const,
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-white/10 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Refunds</h2>
            <p className="text-sm text-zinc-400">
              {isOrganizerScope
                ? "Review refund requests for your events and resolve buyer-facing issues quickly."
                : "Review refund requests, filter by operational context, and use manual refunds only when necessary."}
            </p>
          </div>

          <DrawerClose asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-zinc-400 hover:bg-transparent hover:text-zinc-100"
              aria-label="Close refunds"
            >
              <X className="size-4" />
            </Button>
          </DrawerClose>
        </div>

        {showDebug && (
          <div className="mt-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-zinc-400">
            status={selectedStatus} | source={sourceFilter} | payout={isOrganizerScope ? "all" : payoutTargetFilter} |
            search={searchTerm ?? "none"} | loading={String(isLoading)} | loadingMore=
            {String(isLoadingMore)} | items={items.length} | hasMore={String(hasMore)} | error=
            {error ?? "none"} | limit={listLimit}
          </div>
        )}
      </div>

      {isDesktop ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:grid md:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
          <div className="min-h-[240px] border-b border-white/10 md:border-b-0 md:border-r md:border-white/10">
            <RefundInboxPanel
              items={items}
              counts={counts}
              scope={scope}
              selectedId={selectedId}
              selectedStatus={selectedStatus}
              searchValue={searchDraft}
              sourceFilter={sourceFilter}
              payoutTargetFilter={payoutTargetFilter}
              onSelect={setSelectedId}
              onStatusChange={handleStatusChange}
              onSearchChange={setSearchDraft}
              onSourceFilterChange={handleSourceFilterChange}
              onPayoutTargetFilterChange={handlePayoutTargetFilterChange}
              onRefresh={() => {
                requestReload({ includeCounts: true, showErrorToast: true })
              }}
              onLoadMore={handleLoadMore}
              hasMore={hasMore}
              isLoading={isLoading}
              isLoadingMore={isLoadingMore}
              error={error}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-hidden">
              <RefundDetailsPane
                request={selectedItem}
                scope={scope}
                isApproving={selectedItemPending}
                isRejecting={selectedItemPending}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            </div>

            <div className="border-t border-white/10 px-4 py-4">
              <ManualRefundTool
                onSubmit={handleManualRefund}
                isPending={isPending && activeActionId === "manual-refund"}
              />
            </div>
          </div>
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {showMobileDetails ? (
            <motion.div
              key="details"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={mobileTransition}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-zinc-950/95 px-4 py-3 backdrop-blur">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedId(null)}
                  className="h-8 px-2 text-zinc-300 hover:bg-white/[0.04] hover:text-white"
                >
                  <ChevronLeft className="mr-1 size-4" />
                  Inbox
                </Button>
                <p className="text-sm font-medium text-white">Refund details</p>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <RefundDetailsPane
                  request={selectedItem}
                  scope={scope}
                  isApproving={selectedItemPending}
                  isRejecting={selectedItemPending}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="inbox"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={mobileTransition}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="min-h-0 flex-1 overflow-hidden">
                <RefundInboxPanel
                  items={items}
                  counts={counts}
                  scope={scope}
                  selectedId={selectedId}
                  selectedStatus={selectedStatus}
                  onSelect={setSelectedId}
                  searchValue={searchDraft}
                  sourceFilter={sourceFilter}
                  payoutTargetFilter={payoutTargetFilter}
                  onStatusChange={handleStatusChange}
                  onSearchChange={setSearchDraft}
                  onSourceFilterChange={handleSourceFilterChange}
                  onPayoutTargetFilterChange={handlePayoutTargetFilterChange}
                  onRefresh={() => {
                    requestReload({ includeCounts: true, showErrorToast: true })
                  }}
                  onLoadMore={handleLoadMore}
                  hasMore={hasMore}
                  isLoading={isLoading}
                  isLoadingMore={isLoadingMore}
                  error={error}
                  contentPaddingBottomClassName="pb-28"
                />
              </div>

              {/* STICKY FOOTER */}
              <div className="sticky bottom-0 z-20 border-t border-white/10 bg-zinc-950/95 px-4 py-3 backdrop-blur">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="mb-2 text-xs font-medium text-zinc-300">Advanced tools</p>

                  <ManualRefundTool
                    onSubmit={handleManualRefund}
                    isPending={isPending && activeActionId === "manual-refund"}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}
