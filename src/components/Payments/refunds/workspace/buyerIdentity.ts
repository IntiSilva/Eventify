import type { RefundRequestListItem } from "../types/refunds"

type BuyerIdentityInput = Pick<
  RefundRequestListItem,
  "buyerUserId" | "buyerUsername" | "buyerFirstName" | "buyerLastName" | "buyerEmail"
>

function normalizeOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getBuyerFullName(input: BuyerIdentityInput): string | null {
  const first = normalizeOptional(input.buyerFirstName)
  const last = normalizeOptional(input.buyerLastName)
  if (!first && !last) return null
  return [first, last].filter(Boolean).join(" ")
}

export type BuyerIdentityLabels = {
  primary: string
  secondary: string | null
}

export function getBuyerIdentityLabels(input: BuyerIdentityInput): BuyerIdentityLabels {
  const fullName = getBuyerFullName(input)
  const username = normalizeOptional(input.buyerUsername)
  const usernameLabel = username ? `@${username}` : null
  const email = normalizeOptional(input.buyerEmail)
  const buyerId = normalizeOptional(input.buyerUserId) ?? input.buyerUserId

  const primary = fullName ?? usernameLabel ?? email ?? buyerId
  const secondaryParts = [usernameLabel, email, buyerId].filter(
    (value): value is string => Boolean(value) && value !== primary
  )

  return {
    primary,
    secondary: secondaryParts.length > 0 ? secondaryParts.join(" | ") : null,
  }
}

