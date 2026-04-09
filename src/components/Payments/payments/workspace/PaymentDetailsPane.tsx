"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Check, Copy, Inbox } from "lucide-react"
import { PaymentPayoutTarget } from "@/generated/prisma"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { cn, formatPrice } from "@/lib/utils"
import type { AdminPaymentListItem } from "../types/payments"
import { Separator } from "@/components/ui/separator"

interface PaymentDetailsPaneProps {
  payment: AdminPaymentListItem | null
  scope?: "admin" | "organizer"
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Unknown"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Unknown"
  return parsed.toLocaleString()
}

function getPersonLabel(input: {
  username?: string | null
  firstName?: string | null
  lastName?: string | null
  fallback: string
}): { primary: string; secondary: string | null } {
  const fullName = [normalizeOptional(input.firstName), normalizeOptional(input.lastName)]
    .filter((part): part is string => Boolean(part))
    .join(" ")
  const username = normalizeOptional(input.username)

  if (fullName.length > 0) {
    return {
      primary: fullName,
      secondary: username ? `@${username}` : null,
    }
  }

  if (username) {
    return {
      primary: `@${username}`,
      secondary: null,
    }
  }

  return {
    primary: input.fallback,
    secondary: null,
  }
}

function getRefundStateMeta(refundState: AdminPaymentListItem["refundState"]): {
  label: string
  className: string
} {
  switch (refundState) {
    case "requested":
      return {
        label: "Refund requested",
        className: "border-amber-700/60 bg-amber-950/35 text-amber-200",
      }
    case "processing":
      return {
        label: "Refund processing",
        className: "border-sky-700/60 bg-sky-950/35 text-sky-200",
      }
    case "failed":
      return {
        label: "Refund failed",
        className: "border-rose-700/60 bg-rose-950/35 text-rose-200",
      }
    case "rejected":
      return {
        label: "Refund rejected",
        className: "border-zinc-700/80 bg-zinc-900 text-zinc-200",
      }
    case "succeeded":
      return {
        label: "Refund succeeded",
        className: "border-emerald-700/60 bg-emerald-950/35 text-emerald-200",
      }
    case "canceled":
      return {
        label: "Refund canceled",
        className: "border-zinc-700/80 bg-zinc-900 text-zinc-200",
      }
    case "no_refund":
    default:
      return {
        label: "No refund",
        className: "border-zinc-700/80 bg-zinc-900 text-zinc-300",
      }
  }
}

function getOwnerRoleMeta(ownerRole: AdminPaymentListItem["ownerRole"]): {
  title: string
  idLabel: string
  badgeLabel: "Admin" | "Organizer" | "User" | null
} {
  if (ownerRole === "admin") {
    return {
      title: "Admin owner",
      idLabel: "Admin owner ID",
      badgeLabel: "Admin",
    }
  }

  if (ownerRole === "organizer") {
    return {
      title: "Organizer owner",
      idLabel: "Organizer owner ID",
      badgeLabel: "Organizer",
    }
  }

  if (ownerRole === "user") {
    return {
      title: "User owner",
      idLabel: "User owner ID",
      badgeLabel: "User",
    }
  }

  return {
    title: "Owner",
    idLabel: "Owner ID",
    badgeLabel: null,
  }
}

function getPayoutMeta(target: PaymentPayoutTarget): { label: string; className: string } {
  if (target === PaymentPayoutTarget.organizer) {
    return {
      label: "Organizer payout",
      className: "border-emerald-700/50 bg-emerald-950/35 text-emerald-200",
    }
  }

  return {
    label: "Platform payout",
    className: "border-violet-700/55 bg-violet-950/35 text-violet-200",
  }
}

function getPaymentStatusMeta(status: AdminPaymentListItem["paymentStatus"]): {
  label: string
  chipLabel: string
  className: string
} {
  switch (status) {
    case "pending":
      return {
        label: "Pending",
        chipLabel: "Payment pending",
        className: "border-amber-700/60 bg-amber-950/35 text-amber-200",
      }
    case "failed":
      return {
        label: "Failed",
        chipLabel: "Payment failed",
        className: "border-rose-700/60 bg-rose-950/35 text-rose-200",
      }
    case "canceled":
      return {
        label: "Canceled",
        chipLabel: "Payment canceled",
        className: "border-zinc-700/80 bg-zinc-900 text-zinc-200",
      }
    case "succeeded":
    default:
      return {
        label: "Succeeded",
        chipLabel: "Payment succeeded",
        className: "border-emerald-700/55 bg-emerald-950/35 text-emerald-200",
      }
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
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="break-all text-right text-sm text-zinc-200">{value}</span>
        {copyValue ? <CopyValueButton value={copyValue} label={label} /> : null}
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: string }) {
  return (
    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-300">{children}</p>
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
      <p className="mt-1 break-words text-sm font-medium text-zinc-100">{primary}</p>
      {secondary ? <p className="mt-0.5 break-words text-xs text-zinc-400">{secondary}</p> : null}
      <div className="mt-2">
        <LabelValueRow label={idLabel} value={idValue} copyValue={idValue} />
      </div>
    </div>
  )
}

const SCROLLBAR_CLASSES = cn(
  "[&::-webkit-scrollbar]:w-1",
  "[&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:rounded-full",
  "[&::-webkit-scrollbar-thumb]:bg-emerald-900",
  "[&::-webkit-scrollbar-thumb:hover]:bg-emerald-600",
  "[&::-webkit-scrollbar-thumb:hover]:cursor-pointer"
)

export function PaymentDetailsPane({ payment, scope = "admin" }: PaymentDetailsPaneProps) {
  const isOrganizerScope = scope === "organizer"
  if (!payment) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12">
        <div className="rounded-full bg-zinc-900 p-3">
          <Inbox className="size-5 text-emerald-600" />
        </div>
        <p className="text-center text-sm text-zinc-400">Select a payment to inspect details</p>
      </div>
    )
  }

  const buyer = getPersonLabel({
    username: payment.buyerUsername,
    firstName: payment.buyerFirstName,
    lastName: payment.buyerLastName,
    fallback: payment.buyerUserId,
  })

  const refundMeta = getRefundStateMeta(payment.refundState)
  const payoutMeta = getPayoutMeta(payment.payoutTarget)
  const paymentStatusMeta = getPaymentStatusMeta(payment.paymentStatus)
  const owner = !isOrganizerScope
    ? getPersonLabel({
        username: payment.ownerUsername,
        firstName: payment.ownerFirstName,
        lastName: payment.ownerLastName,
        fallback: payment.ownerClerkId,
      })
    : null
  const ownerRoleMeta = !isOrganizerScope ? getOwnerRoleMeta(payment.ownerRole) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Payment summary</p>
            <h3 className="mt-0.5 truncate text-sm font-semibold text-white">{payment.eventTitle}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                  paymentStatusMeta.className
                )}
              >
                {paymentStatusMeta.chipLabel}
              </span>
              {!isOrganizerScope ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                    payoutMeta.className
                  )}
                >
                  {payoutMeta.label}
                </span>
              ) : null}
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                  refundMeta.className
                )}
              >
                {refundMeta.label}
              </span>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Amount</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-white">
              {formatPrice(payment.amountCents, payment.currency) || payment.currency}
            </p>
          </div>
        </div>
      </div>

      <div className={cn("flex-1 overflow-y-auto overscroll-contain px-4 py-3", SCROLLBAR_CLASSES)}>
        <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <SectionHeading>People</SectionHeading>
          <div className={cn("grid gap-2", isOrganizerScope ? "md:grid-cols-1" : "md:grid-cols-2")}>
            {!isOrganizerScope && owner && ownerRoleMeta ? (
              <IdentityCard
                title={ownerRoleMeta.title}
                roleBadge={
                  ownerRoleMeta.badgeLabel ? (
                    <span className="inline-flex items-center rounded-md border border-zinc-700/70 bg-zinc-900/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200">
                      {ownerRoleMeta.badgeLabel}
                    </span>
                  ) : null
                }
                primary={owner.primary}
                secondary={owner.secondary}
                idLabel={ownerRoleMeta.idLabel}
                idValue={payment.ownerClerkId}
              />
            ) : null}
            <IdentityCard
              title="Buyer"
              primary={buyer.primary}
              secondary={
                [buyer.secondary, normalizeOptional(payment.buyerEmail)]
                  .filter((value): value is string => Boolean(value))
                  .filter((value, index, array) => array.indexOf(value) === index)
                  .join(" | ") || null
              }
              idLabel="Buyer ID"
              idValue={payment.buyerUserId}
            />
          </div>
        </section>

        <section className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <SectionHeading>Event And Money</SectionHeading>
          <Separator className="my-2 bg-zinc-800" />
          <div className="space-y-2">
            <LabelValueRow label="Event" value={payment.eventTitle} />
            <LabelValueRow label="Event ID" value={payment.eventId} copyValue={payment.eventId} />
            <LabelValueRow label="Event date" value={formatTimestamp(payment.eventDate)} />
            <LabelValueRow
              label="Amount"
              value={formatPrice(payment.amountCents, payment.currency) || payment.currency}
            />
            <LabelValueRow label="Created at" value={formatTimestamp(payment.createdAt)} />
          </div>
        </section>

        {!isOrganizerScope ? (
          <section className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <SectionHeading>Payout Routing</SectionHeading>
            <Separator className="my-2 bg-zinc-800" />
            <div className="space-y-2">
              <LabelValueRow label="Payout target" value={payoutMeta.label} />
              <LabelValueRow
                label="Destination account"
                value={payment.destinationAccountId ?? "Not set"}
                copyValue={payment.destinationAccountId}
              />
              <LabelValueRow
                label="Transfer group"
                value={payment.transferGroup ?? "Not set"}
                copyValue={payment.transferGroup}
              />
              <LabelValueRow
                label="Application fee"
                value={
                  payment.applicationFeeAmount != null
                    ? formatPrice(payment.applicationFeeAmount, payment.currency) ||
                      String(payment.applicationFeeAmount)
                    : "Not set"
                }
              />
            </div>
          </section>
        ) : null}

        <section className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <SectionHeading>Refund Relation</SectionHeading>
          <Separator className="my-2 bg-zinc-800" />
          <div className="space-y-2">
            <LabelValueRow label="Payment status" value={paymentStatusMeta.label} />
            <LabelValueRow label="Refund state" value={refundMeta.label} />
            {payment.refundRequestId ? (
              <>
                <LabelValueRow
                  label="Refund request ID"
                  value={payment.refundRequestId}
                  copyValue={payment.refundRequestId}
                />
                <LabelValueRow
                  label="Refund request status"
                  value={payment.refundStatus ?? "Unknown"}
                />
                <LabelValueRow label="Refund source" value={payment.refundSource ?? "Unknown"} />
                <LabelValueRow
                  label="Requested at"
                  value={formatTimestamp(payment.refundCreatedAt)}
                />
                <LabelValueRow
                  label="Attempt count"
                  value={String(payment.refundAttemptCount ?? 0)}
                />
                {payment.refundLastAttemptAt ? (
                  <LabelValueRow
                    label="Last attempt"
                    value={formatTimestamp(payment.refundLastAttemptAt)}
                  />
                ) : null}
                {payment.refundDecisionNote ? (
                  <div className="rounded-md border border-zinc-800 bg-black/30 p-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">Decision note</p>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-300">
                      {payment.refundDecisionNote}
                    </p>
                  </div>
                ) : null}
                {payment.refundLastError ? (
                  <div className="rounded-md border border-rose-900/60 bg-rose-950/20 p-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-rose-300">Last error</p>
                    <p className="mt-1 text-sm leading-relaxed text-rose-200">{payment.refundLastError}</p>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-zinc-300">No refund request linked to this payment.</p>
            )}
          </div>
        </section>

        <Accordion type="single" collapsible className="mt-3">
          <AccordionItem
            value="diagnostics"
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3"
          >
            <AccordionTrigger className="cursor-pointer py-2 text-xs text-zinc-400 hover:no-underline">
              Diagnostics
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pb-3">
              <LabelValueRow label="Payment ID" value={payment.paymentId} copyValue={payment.paymentId} />
              <LabelValueRow
                label="Payment intent"
                value={payment.stripePaymentIntentId}
                copyValue={payment.stripePaymentIntentId}
              />
              <LabelValueRow
                label="Stripe charge"
                value={payment.stripeChargeId ?? "Not set"}
                copyValue={payment.stripeChargeId}
              />
              <LabelValueRow
                label="Balance transaction"
                value={payment.stripeBalanceTransactionId ?? "Not set"}
                copyValue={payment.stripeBalanceTransactionId}
              />
              <LabelValueRow
                label="Stripe transfer"
                value={payment.stripeTransferId ?? "Not set"}
                copyValue={payment.stripeTransferId}
              />
              <LabelValueRow
                label="Application fee ID"
                value={payment.stripeApplicationFeeId ?? "Not set"}
                copyValue={payment.stripeApplicationFeeId}
              />
              <LabelValueRow
                label="Stripe refund ID"
                value={payment.stripeRefundId ?? "Not set"}
                copyValue={payment.stripeRefundId}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  )
}
