"use client"

import type { RefundRequestListItem } from "../types/refunds"
import {
  PaymentPayoutTarget,
  RefundRequestSource,
  UserRole,
} from "@/generated/prisma"
import { RefundStatusBadge } from "./RefundStatusChips"
import { cn, formatPrice } from "@/lib/utils"

interface RefundRequestRowProps {
  request: RefundRequestListItem
  isSelected: boolean
  scope?: "admin" | "organizer"
  onSelect: (refundRequestId: string) => void
}

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

function formatIdentity(username: string | null, fallbackId: string) {
  const normalizedUsername = normalizeOptional(username)
  return normalizedUsername ? `@${normalizedUsername}` : fallbackId
}

function getCounterpartyMeta(role: UserRole | null): {
  label: string
  badgeClassName: string
} {
  if (role === UserRole.organizer) {
    return {
      label: "Organizer",
      badgeClassName:
        "border-emerald-700/50 bg-emerald-950/40 text-emerald-200",
    }
  }

  if (role === UserRole.admin) {
    return {
      label: "Admin",
      badgeClassName:
        "border-rose-700/55 bg-rose-950/35 text-rose-200",
    }
  }

  return {
    label: "Counterparty",
    badgeClassName: "border-zinc-700/70 bg-zinc-900/70 text-zinc-200",
  }
}

function getRefundSourceMeta(source: RefundRequestSource): {
  label: string
  className: string
} {
  switch (source) {
    case RefundRequestSource.MANUAL_OVERRIDE:
      return {
        label: "Manual",
        className: "border-violet-700/50 bg-violet-950/30 text-violet-200",
      }
    case RefundRequestSource.SYSTEM_COMPENSATION:
      return {
        label: "System",
        className: "border-cyan-700/60 bg-cyan-950/35 text-cyan-200",
      }
    case RefundRequestSource.USER_REQUEST:
    default:
      return {
        label: "User request",
        className: "border-zinc-700/70 bg-zinc-900/70 text-zinc-300",
      }
  }
}

export function RefundRequestRow({
  request,
  isSelected,
  scope = "admin",
  onSelect,
}: RefundRequestRowProps) {
  const isOrganizerScope = scope === "organizer"
  const buyerLabel = formatIdentity(request.buyerUsername, request.buyerUserId)
  const counterpartyLabel = formatIdentity(
    request.organizerUsername,
    request.organizerClerkId
  )
  const counterpartyMeta = getCounterpartyMeta(request.counterpartyRole)
  const sourceMeta = getRefundSourceMeta(request.source)
  const payoutLabel =
    request.payoutTarget === PaymentPayoutTarget.organizer
      ? "Organizer payout"
      : "Platform payout"

  return (
    <button
      type="button"
      onClick={() => onSelect(request.refundRequestId)}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer",
        "border-b border-border/50 last:border-b-0",
        "hover:bg-rose-900/7 focus-visible:bg-accent/50",
        "focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none",
        isSelected && "bg-rose-900/20"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-white font-medium truncate">
            {request.eventTitle}
          </span>
          <RefundStatusBadge status={request.status} />
          {!isOrganizerScope ? (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                counterpartyMeta.badgeClassName
              )}
            >
              {counterpartyMeta.label}
            </span>
          ) : null}
        </div>
        {isOrganizerScope ? (
          <p className="mt-1 min-w-0 truncate text-xs text-zinc-300">
            <span className="text-zinc-500">Buyer:</span>{" "}
            <span className="text-zinc-200">{buyerLabel}</span>
          </p>
        ) : (
          <p className="mt-1 min-w-0 truncate text-xs text-zinc-300">
            <span className="text-zinc-500">{counterpartyMeta.label}:</span>{" "}
            <span className="text-zinc-200">{counterpartyLabel}</span>
            <span className="mx-1 text-zinc-600">|</span>
            <span className="text-zinc-500">Buyer:</span>{" "}
            <span className="text-zinc-200">{buyerLabel}</span>
          </p>
        )}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
              sourceMeta.className
            )}
          >
            {sourceMeta.label}
          </span>
          {!isOrganizerScope ? (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                request.payoutTarget === PaymentPayoutTarget.organizer
                  ? "border-emerald-700/50 bg-emerald-950/35 text-emerald-200"
                  : "border-violet-700/50 bg-violet-950/35 text-violet-200"
              )}
            >
              {payoutLabel}
            </span>
          ) : null}
          <span className="shrink-0 text-[11px] text-zinc-500">
            {formatTimestamp(request.createdAt)}
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <span className="text-sm font-semibold tabular-nums text-white leading-none">
          {formatPrice(request.amountCents, request.currency) || request.currency}
        </span>
        <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">
          Refund amount
        </p>
      </div>
    </button>
  )
}

export function RefundRequestRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border/50 px-3 py-3.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="h-4 w-40 rounded bg-zinc-800 animate-pulse" />
          <div className="h-4 w-16 rounded bg-zinc-800 animate-pulse" />
          <div className="h-4 w-14 rounded bg-zinc-800 animate-pulse" />
        </div>
        <div className="mt-1 h-3 w-64 rounded bg-zinc-800 animate-pulse" />
        <div className="mt-1 flex items-center gap-2">
          <div className="h-3 w-20 rounded bg-zinc-800 animate-pulse" />
          <div className="h-3 w-24 rounded bg-zinc-800 animate-pulse" />
          <div className="h-3 w-28 rounded bg-zinc-800 animate-pulse" />
        </div>
        <div className="mt-1 h-3 w-32 rounded bg-zinc-800 animate-pulse" />
      </div>
      <div className="shrink-0 space-y-1 text-right">
        <div className="h-4 w-16 rounded bg-zinc-800 animate-pulse" />
        <div className="h-3 w-20 rounded bg-zinc-800 animate-pulse" />
      </div>
    </div>
  )
}
