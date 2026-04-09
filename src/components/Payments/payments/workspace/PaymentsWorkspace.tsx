"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { DrawerClose } from "@/components/ui/drawer"
import { useMediaQuery } from "@/lib/hooks"
import type {
  AdminPaymentCurrencyFilter,
  AdminPaymentListItem,
  AdminPaymentPayoutTargetFilter,
  AdminPaymentStatusFilter,
  AdminPaymentRefundStateFilter,
  AdminPaymentsListApiResponse,
} from "../types/payments"
import { PaymentInboxPanel } from "./PaymentInboxPanel"
import { PaymentDetailsPane } from "./PaymentDetailsPane"

const DEFAULT_LIST_LIMIT = 40
const LOAD_MORE_STEP = 20
const SEARCH_DEBOUNCE_MS = 250

type PaymentsWorkspaceScope = "admin" | "organizer"

interface PaymentsWorkspaceProps {
  scope?: PaymentsWorkspaceScope
}

export function PaymentsWorkspace({ scope = "admin" }: PaymentsWorkspaceProps) {
  const isOrganizerScope = scope === "organizer"
  const [paymentStatus, setPaymentStatus] = useState<AdminPaymentStatusFilter>("all")
  const [currency, setCurrency] = useState<AdminPaymentCurrencyFilter>("all")
  const [refundState, setRefundState] = useState<AdminPaymentRefundStateFilter>("all")
  const [payoutTarget, setPayoutTarget] = useState<AdminPaymentPayoutTargetFilter>("all")
  const [searchDraft, setSearchDraft] = useState("")
  const [searchTerm, setSearchTerm] = useState<string | null>(null)
  const [listLimit, setListLimit] = useState(DEFAULT_LIST_LIMIT)
  const [items, setItems] = useState<AdminPaymentListItem[]>([])
  const [availableCurrencies, setAvailableCurrencies] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const paymentsEndpoint = isOrganizerScope ? "/api/organizer/payments" : "/api/admin/payments"
  const workspaceTitle = isOrganizerScope ? "Your payments" : "Payments"
  const workspaceDescription =
    isOrganizerScope
      ? "Inspect payments tied to your paid events with buyer and refund context."
      : "Inspect paid-event payments across statuses with buyer, owner, payout, and refund context."

  const requestIdRef = useRef(0)
  const isDesktopRef = useRef(isDesktop)
  const softLoadNextLoadRef = useRef(false)

  useEffect(() => {
    isDesktopRef.current = isDesktop
  }, [isDesktop])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalized = searchDraft.trim()
      setSearchTerm(normalized.length > 0 ? normalized : null)
    }, SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [searchDraft])

  useEffect(() => {
    setListLimit((current) =>
      current === DEFAULT_LIST_LIMIT ? current : DEFAULT_LIST_LIMIT
    )
  }, [searchTerm, paymentStatus, currency, refundState, payoutTarget])

  useEffect(() => {
    const reqId = ++requestIdRef.current
    const softLoad = softLoadNextLoadRef.current
    softLoadNextLoadRef.current = false

    async function run() {
      if (softLoad) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setError(null)
      }

      try {
        const params = new URLSearchParams()
        params.set("limit", String(listLimit))
        params.set("paymentStatus", paymentStatus)
        if (currency !== "all") {
          params.set("currency", currency)
        }
        params.set("refundState", refundState)
        if (!isOrganizerScope && payoutTarget !== "all") {
          params.set("payoutTarget", payoutTarget)
        }
        if (searchTerm) {
          params.set("search", searchTerm)
        }

        const res = await fetch(`${paymentsEndpoint}?${params.toString()}`, {
          cache: "no-store",
        })

        const json = (await res
          .json()
          .catch(() => null)) as AdminPaymentsListApiResponse | null

        if (reqId !== requestIdRef.current) return

        if (!res.ok || !json || json.success !== true) {
          const message =
            json && json.success === false && typeof json.error === "string"
              ? json.error
              : `Could not load payments (HTTP ${res.status})`
          throw new Error(message)
        }

        setItems(json.data)
        setHasMore(json.hasMore === true)
        setAvailableCurrencies(Array.isArray(json.availableCurrencies) ? json.availableCurrencies : [])
        setSelectedId((current) => {
          if (current && json.data.some((item) => item.paymentId === current)) {
            return current
          }

          if (!isDesktopRef.current) {
            return null
          }

          return json.data[0]?.paymentId ?? null
        })
      } catch (loadError) {
        if (reqId !== requestIdRef.current) return

        const message =
          loadError instanceof Error && loadError.message.trim().length > 0
            ? loadError.message
            : "Could not load payments"

        if (softLoad) {
          setIsLoadingMore(false)
          return
        }

        setItems([])
        setHasMore(false)
        setAvailableCurrencies([])
        setSelectedId(null)
        setError(message)
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
    paymentStatus,
    currency,
    refundState,
    payoutTarget,
    searchTerm,
    listLimit,
    paymentsEndpoint,
    isOrganizerScope,
  ])

  const selectedItem = useMemo(
    () => items.find((item) => item.paymentId === selectedId) ?? null,
    [items, selectedId]
  )

  const requestReload = () => {
    setRefreshVersion((current) => current + 1)
  }

  const handleLoadMore = () => {
    if (hasMore !== true || isLoading || isLoadingMore) return
    softLoadNextLoadRef.current = true
    setListLimit((current) => Math.min(120, current + LOAD_MORE_STEP))
  }

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
            <h2 className="text-lg font-semibold text-white">{workspaceTitle}</h2>
            <p className="text-sm text-zinc-400">
              {workspaceDescription}
            </p>
          </div>

          <DrawerClose asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-zinc-400 hover:bg-transparent hover:text-zinc-100"
              aria-label={
                scope === "organizer" ? "Close organizer payments" : "Close payments"
              }
            >
              <X className="size-4" />
            </Button>
          </DrawerClose>
        </div>
      </div>

      {isDesktop ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:grid md:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
          <div className="min-h-[240px] border-b border-white/10 md:border-b-0 md:border-r md:border-white/10">
            <PaymentInboxPanel
              items={items}
              selectedId={selectedId}
              scope={scope}
              searchValue={searchDraft}
              paymentStatus={paymentStatus}
              currency={currency}
              availableCurrencies={availableCurrencies}
              refundState={refundState}
              payoutTarget={payoutTarget}
              onSelect={setSelectedId}
              onSearchChange={setSearchDraft}
              onPaymentStatusChange={setPaymentStatus}
              onCurrencyChange={setCurrency}
              onRefundStateChange={setRefundState}
              onPayoutTargetChange={setPayoutTarget}
              onRefresh={requestReload}
              onLoadMore={handleLoadMore}
              hasMore={hasMore}
              isLoading={isLoading}
              isLoadingMore={isLoadingMore}
              error={error}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-hidden">
              <PaymentDetailsPane payment={selectedItem} scope={scope} />
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
                <p className="text-sm font-medium text-white">Payment details</p>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <PaymentDetailsPane payment={selectedItem} scope={scope} />
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
                <PaymentInboxPanel
                  items={items}
                  selectedId={selectedId}
                  scope={scope}
                  searchValue={searchDraft}
                  paymentStatus={paymentStatus}
                  currency={currency}
                  availableCurrencies={availableCurrencies}
                  refundState={refundState}
                  payoutTarget={payoutTarget}
                  onSelect={setSelectedId}
                  onSearchChange={setSearchDraft}
                  onPaymentStatusChange={setPaymentStatus}
                  onCurrencyChange={setCurrency}
                  onRefundStateChange={setRefundState}
                  onPayoutTargetChange={setPayoutTarget}
                  onRefresh={requestReload}
                  onLoadMore={handleLoadMore}
                  hasMore={hasMore}
                  isLoading={isLoading}
                  isLoadingMore={isLoadingMore}
                  error={error}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}
