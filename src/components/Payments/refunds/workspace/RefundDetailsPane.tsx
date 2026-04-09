"use client"

import { useEffect, useState, type ReactNode } from "react"
import {
  Check,
  CheckCircle2,
  Copy,
  Inbox,
  XCircle,
} from "lucide-react"
import {
  PaymentPayoutTarget,
  RefundRequestSource,
  RefundRequestStatus,
  UserRole,
} from "@/generated/prisma"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import type { RefundRequestListItem } from "../types/refunds"
import { RefundStatusBadge } from "./RefundStatusChips"
import { cn, formatPrice } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"

interface RefundDetailsPaneProps {
  request: RefundRequestListItem | null
  scope?: "admin" | "organizer"
  isApproving?: boolean
  isRejecting?: boolean
  onApprove: (refundRequestId: string) => Promise<boolean>
  onReject: (refundRequestId: string, note?: string | null) => Promise<boolean>
}

const SCROLLBAR_CLASSES = cn(
  "[&::-webkit-scrollbar]:w-1",
  "[&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:rounded-full",
  "[&::-webkit-scrollbar-thumb]:bg-rose-900",
  "[&::-webkit-scrollbar-thumb:hover]:bg-rose-600",
  "[&::-webkit-scrollbar-thumb:hover]:cursor-pointer"
)

function formatTimestamp(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Unknown"
  return parsed.toLocaleString()
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getCounterpartyMeta(role: UserRole | null): {
  label: string
  idLabel: string
  badgeClassName: string
} {
  if (role === UserRole.organizer) {
    return {
      label: "Organizer",
      idLabel: "Organizer ID",
      badgeClassName:
        "border-emerald-700/50 bg-emerald-950/35 text-emerald-200",
    }
  }

  if (role === UserRole.admin) {
    return {
      label: "Admin",
      idLabel: "Admin ID",
      badgeClassName:
        "border-rose-700/55 bg-rose-950/35 text-rose-200",
    }
  }

  if (role === UserRole.user) {
    return {
      label: "User",
      idLabel: "User ID",
      badgeClassName: "border-zinc-700/70 bg-zinc-900/70 text-zinc-200",
    }
  }

  return {
    label: "Counterparty",
    idLabel: "Counterparty ID",
    badgeClassName: "border-zinc-700/70 bg-zinc-900/70 text-zinc-200",
  }
}

function getRefundSourceMeta(source: RefundRequestSource): {
  label: string
  badgeClassName: string
} {
  switch (source) {
    case RefundRequestSource.MANUAL_OVERRIDE:
      return {
        label: "Manual override",
        badgeClassName:
          "border-violet-700/55 bg-violet-950/35 text-violet-200",
      }
    case RefundRequestSource.SYSTEM_COMPENSATION:
      return {
        label: "System compensation",
        badgeClassName: "border-cyan-700/60 bg-cyan-950/35 text-cyan-200",
      }
    case RefundRequestSource.USER_REQUEST:
    default:
      return {
        label: "User request",
        badgeClassName: "border-zinc-700/70 bg-zinc-900/70 text-zinc-200",
      }
  }
}

function getPayoutMeta(target: PaymentPayoutTarget): {
  label: string
  badgeClassName: string
} {
  if (target === PaymentPayoutTarget.organizer) {
    return {
      label: "Organizer payout",
      badgeClassName:
        "border-emerald-700/50 bg-emerald-950/35 text-emerald-200",
    }
  }

  return {
    label: "Platform payout",
    badgeClassName: "border-violet-700/55 bg-violet-950/35 text-violet-200",
  }
}

function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/40 text-zinc-400 transition-colors hover:text-zinc-100 cursor-pointer"
      aria-label={`Copy ${label}`}
      title={copied ? `${label} copied` : `Copy ${label}`}
    >
      {copied ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3" />}
    </button>
  )
}

function LabelValueRow({
  label,
  value,
  copyValue,
}: {
  label: string
  value: string
  copyValue?: string | null
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="break-all text-right text-sm text-zinc-200">{value}</span>
        {copyValue ? <CopyValueButton value={copyValue} label={label} /> : null}
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: string }) {
  return (
    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-300">
      {children}
    </p>
  )
}

function IdentityCard({
  title,
  roleBadge,
  primary,
  secondary,
  idLabel,
  idValue,
}: {
  title: string
  roleBadge?: ReactNode
  primary: string
  secondary?: string | null
  idLabel: string
  idValue: string
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-300">{title}</p>
        {roleBadge}
      </div>
      <p className="mt-1 text-sm font-medium text-zinc-100 break-words">{primary}</p>
      {secondary ? (
        <p className="mt-0.5 text-xs text-zinc-400 break-words">{secondary}</p>
      ) : null}
      <div className="mt-2">
        <LabelValueRow label={idLabel} value={idValue} copyValue={idValue} />
      </div>
    </div>
  )
}

function DiagnosticChip({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border border-white/10 bg-black/30 px-2 py-1">
      <span className="min-w-0 break-all font-mono text-xs text-zinc-300 select-text">{value}</span>
      <CopyValueButton value={value} label={label} />
    </div>
  )
}

export function RefundDetailsPane({
  request,
  scope = "admin",
  isApproving = false,
  isRejecting = false,
  onApprove,
  onReject,
}: RefundDetailsPaneProps) {
  const isOrganizerScope = scope === "organizer"
  const [rejectDraft, setRejectDraft] = useState<{
    requestId: string | null
    open: boolean
    note: string
  }>({
    requestId: null,
    open: false,
    note: "",
  })

  if (!request) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12">
        <div className="rounded-full bg-zinc-900 p-3">
          <Inbox className="size-5 text-rose-600" />
        </div>
        <p className="text-sm text-zinc-400 text-center">
          Select a refund request to view details
        </p>
      </div>
    )
  }

  const canAct = request.status === RefundRequestStatus.requested
  const showRejectComposer =
    rejectDraft.requestId === request.refundRequestId && rejectDraft.open
  const rejectNote =
    rejectDraft.requestId === request.refundRequestId ? rejectDraft.note : ""

  const buyerName = [normalizeOptional(request.buyerFirstName), normalizeOptional(request.buyerLastName)]
    .filter((value): value is string => value !== null)
    .join(" ")
  const buyerUsername = normalizeOptional(request.buyerUsername)
  const buyerEmail = normalizeOptional(request.buyerEmail)
  const buyerPrimary =
    buyerName.length > 0
      ? buyerName
      : buyerUsername
      ? `@${buyerUsername}`
      : request.buyerUserId

  const counterpartyName = [
    normalizeOptional(request.organizerFirstName),
    normalizeOptional(request.organizerLastName),
  ]
    .filter((value): value is string => value !== null)
    .join(" ")
  const counterpartyUsername = normalizeOptional(request.organizerUsername)
  const counterpartyPrimary =
    counterpartyName.length > 0
      ? counterpartyName
      : counterpartyUsername
      ? `@${counterpartyUsername}`
      : request.organizerClerkId
  const counterpartySecondary =
    counterpartyUsername && counterpartyName.length > 0
      ? `@${counterpartyUsername}`
      : null

  const counterpartyMeta = !isOrganizerScope ? getCounterpartyMeta(request.counterpartyRole) : null
  const sourceMeta = getRefundSourceMeta(request.source)
  const payoutMeta = getPayoutMeta(request.payoutTarget)

  const buyerSecondaryParts = [buyerUsername ? `@${buyerUsername}` : null, buyerEmail]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, array) => array.indexOf(value) === index)
  const buyerSecondary =
    buyerName.length > 0 && buyerSecondaryParts.length > 0
      ? buyerSecondaryParts.join(" | ")
      : buyerName.length === 0 && buyerEmail
      ? buyerEmail
      : null

  const handleReject = async () => {
    const didSucceed = await onReject(
      request.refundRequestId,
      rejectNote.trim().length > 0 ? rejectNote.trim() : null
    )

    if (!didSucceed) return

    setRejectDraft({
      requestId: request.refundRequestId,
      open: false,
      note: "",
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Summary</p>
            <h3 className="truncate text-sm font-semibold text-white mt-0.5">
              {request.eventTitle}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <RefundStatusBadge status={request.status} />
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                  sourceMeta.badgeClassName
                )}
              >
                {sourceMeta.label}
              </span>
              {!isOrganizerScope ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                    payoutMeta.badgeClassName
                  )}
                >
                  {payoutMeta.label}
                </span>
              ) : null}
            </div>
          </div>

          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Refund amount</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-white">
              {formatPrice(request.amountCents, request.currency) || request.currency}
            </p>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "flex-1 overflow-y-auto overscroll-contain px-4 py-3",
          SCROLLBAR_CLASSES
        )}
      >
        <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <SectionHeading>People</SectionHeading>
          <div className={cn("grid gap-2", isOrganizerScope ? "md:grid-cols-1" : "md:grid-cols-2")}>
            {!isOrganizerScope && counterpartyMeta ? (
              <IdentityCard
                title={counterpartyMeta.label}
                roleBadge={
                  <span
                    className={cn(
                      "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                      counterpartyMeta.badgeClassName
                    )}
                  >
                    {counterpartyMeta.label}
                  </span>
                }
                primary={counterpartyPrimary}
                secondary={counterpartySecondary}
                idLabel={counterpartyMeta.idLabel}
                idValue={request.organizerClerkId}
              />
            ) : null}
            <IdentityCard
              title="Buyer"
              primary={buyerPrimary}
              secondary={buyerSecondary}
              idLabel="Buyer ID"
              idValue={request.buyerUserId}
            />
          </div>
        </section>

        <section className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <SectionHeading>{isOrganizerScope ? "Payment Context" : "Money And Payout"}</SectionHeading>
          <Separator className="my-2 bg-zinc-800" />
          <div className="space-y-2">
            <LabelValueRow
              label="Amount"
              value={formatPrice(request.amountCents, request.currency) || request.currency}
            />
            {!isOrganizerScope ? <LabelValueRow label="Payout target" value={payoutMeta.label} /> : null}
            <LabelValueRow label="Source" value={sourceMeta.label} />
            <LabelValueRow label="Payment ID" value={request.paymentId} copyValue={request.paymentId} />
            <LabelValueRow label="Event ID" value={request.eventId} copyValue={request.eventId} />
            {request.applicationFeeAmount != null ? (
              <LabelValueRow
                label="Application fee"
                value={
                  formatPrice(request.applicationFeeAmount, request.currency) ||
                  String(request.applicationFeeAmount)
                }
              />
            ) : null}
            {request.destinationAccountId ? (
              <LabelValueRow
                label="Destination account"
                value={request.destinationAccountId}
                copyValue={request.destinationAccountId}
              />
            ) : null}
            {request.transferGroup ? (
              <LabelValueRow
                label="Transfer group"
                value={request.transferGroup}
                copyValue={request.transferGroup}
              />
            ) : null}
          </div>
        </section>

        <section className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <SectionHeading>Timeline</SectionHeading>
          <Separator className="my-2 bg-zinc-800" />
          <div className="space-y-2">
            <LabelValueRow label="Requested at" value={formatTimestamp(request.createdAt)} />
            <LabelValueRow label="Status" value={request.status} />
            <LabelValueRow label="Attempt count" value={String(request.attemptCount)} />
            {request.lastAttemptAt ? (
              <LabelValueRow
                label="Last attempt"
                value={formatTimestamp(request.lastAttemptAt)}
              />
            ) : null}
          </div>
        </section>

        <section className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <SectionHeading>Reason</SectionHeading>
          <Separator className="my-2 bg-zinc-800" />
          <p className="text-sm leading-relaxed text-zinc-200">
            {request.reason || "No reason provided."}
          </p>

          {request.decisionNote ? (
            <div className="mt-3 rounded-md border border-zinc-800 bg-black/30 p-2.5">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                Decision note
              </p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-300">
                {request.decisionNote}
              </p>
            </div>
          ) : null}

          {request.status === RefundRequestStatus.failed && request.lastError ? (
            <div className="mt-3 rounded-md border border-rose-900/60 bg-rose-950/20 p-2.5">
              <p className="text-[11px] uppercase tracking-wide text-rose-300">
                Last error
              </p>
              <p className="mt-1 text-sm leading-relaxed text-rose-200">
                {request.lastError}
              </p>
            </div>
          ) : null}
        </section>

        <Accordion type="single" collapsible className="mt-3">
          <AccordionItem value="diagnostics" className="rounded-lg border border-white/10 bg-white/[0.03] px-3">
            <AccordionTrigger className="py-2 text-xs text-zinc-400 hover:no-underline cursor-pointer">
              Diagnostics
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <div
                className={cn(
                  "flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md bg-black/30 p-3 pr-2",
                  SCROLLBAR_CLASSES
                )}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    Refund ID
                  </span>
                  <DiagnosticChip value={request.refundRequestId} label="refund ID" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    Event ID
                  </span>
                  <DiagnosticChip value={request.eventId} label="event ID" />
                </div>
                {request.transferGroup ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      Transfer Group
                    </span>
                    <DiagnosticChip value={request.transferGroup} label="transfer group" />
                  </div>
                ) : null}
                {request.destinationAccountId ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      Destination
                    </span>
                    <DiagnosticChip
                      value={request.destinationAccountId}
                      label="destination account"
                    />
                  </div>
                ) : null}
                {request.stripeRefundId ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      Stripe Refund
                    </span>
                    <DiagnosticChip value={request.stripeRefundId} label="stripe refund ID" />
                  </div>
                ) : null}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {canAct ? (
        <div className="border-t border-white/10 px-4 py-3">
          {showRejectComposer ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor={`refund-reject-note-${request.refundRequestId}`}
                  className="text-xs font-medium text-zinc-300"
                >
                  Rejection note (optional)
                </label>
                <Textarea
                  id={`refund-reject-note-${request.refundRequestId}`}
                  value={rejectNote}
                  onChange={(event) =>
                    setRejectDraft({
                      requestId: request.refundRequestId,
                      open: true,
                      note: event.target.value.slice(0, 500),
                    })
                  }
                  maxLength={500}
                  placeholder="Explain why this refund is being rejected."
                  className="min-h-20 border-zinc-800 bg-black/30 text-sm text-zinc-100 placeholder:text-zinc-500"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-zinc-500">{rejectNote.length}/500</span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setRejectDraft({
                        requestId: request.refundRequestId,
                        open: false,
                        note: "",
                      })
                    }
                    disabled={isRejecting}
                    className="text-zinc-400 hover:bg-transparent hover:text-zinc-100"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleReject}
                    disabled={isRejecting}
                    className="border-rose-800 bg-rose-950/50 text-rose-100 hover:bg-rose-900/60 hover:border-rose-700"
                  >
                    {isRejecting ? "Working..." : "Confirm Reject"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => onApprove(request.refundRequestId)}
                disabled={isApproving}
                className="flex-1 border-emerald-700 bg-emerald-950/45 text-emerald-100 hover:border-emerald-600 hover:bg-emerald-900/55 hover:text-emerald-300"
              >
                <CheckCircle2 className="size-3.5 mr-1.5" />
                {isApproving ? "Working..." : "Approve"}
              </Button>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() =>
                  setRejectDraft((current) => ({
                    requestId: request.refundRequestId,
                    open: true,
                    note:
                      current.requestId === request.refundRequestId
                        ? current.note
                        : "",
                  }))
                }
                disabled={isRejecting}
                className="flex-1 border-rose-800 bg-rose-950/50 text-rose-100 hover:bg-rose-900/60 hover:border-rose-700 hover:text-rose-300"
              >
                <XCircle className="size-3.5 mr-1.5" />
                Reject
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
