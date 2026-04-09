'use client'

import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  Loader2,
  ReceiptText,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import type { AdminSelectedUserWorkspaceStatsSnapshot } from '@/lib/data'
import { cn, formatPrice } from '@/lib/utils'
import AnimatedCounter from '@/components/AnimatedText/AnimatedCounter'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type SelectedUserWorkspaceStatsProps = {
  stats: AdminSelectedUserWorkspaceStatsSnapshot | null
  isLoading: boolean
  hasError: boolean
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatCurrencyAmount(amountCents: number, currency: string): string {
  return (
    formatPrice(amountCents, currency) ||
    `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`
  )
}

function placesFor(value: number): number[] {
  const normalized = Math.max(0, Math.floor(value))
  const length = String(normalized).length || 1
  return Array.from({ length }, (_, index) => 10 ** (length - index - 1))
}

function digitsForInteger(value: number): number {
  return String(Math.max(0, Math.floor(value))).length || 1
}

function DigitSkeleton({
  units,
  unitWidth = '1.35ch',
  heightPx = 22,
}: {
  units: number
  unitWidth?: string
  heightPx?: number
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: Math.max(1, units) }).map((_, idx) => (
        <span
          key={idx}
          className="animate-pulse rounded-sm bg-white/10"
          style={{ width: unitWidth, height: `${heightPx}px` }}
        />
      ))}
    </span>
  )
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  emphasize = false,
  animatedValue = null,
  isValueLoading = false,
  loadingUnits = 1,
}: {
  label: string
  value: string
  detail: string
  icon: ReactNode
  emphasize?: boolean
  animatedValue?: number | null
  isValueLoading?: boolean
  loadingUnits?: number
}) {
  const counterFontSize = 22
  const normalizedAnimatedValue =
    typeof animatedValue === 'number' ? Math.max(0, Math.floor(animatedValue)) : null

  return (
    <article
      className={cn(
        'flex h-full min-h-[132px] flex-col rounded-lg border px-3 py-2.5',
        emphasize
          ? 'border-amber-500/30 bg-amber-950/15'
          : 'border-zinc-800/80 bg-zinc-950/45'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
        <span className="inline-flex size-6 items-center justify-center rounded-md border border-white/10 bg-black/25 text-zinc-400">
          {icon}
        </span>
      </div>

      <div className="mt-1 flex-1">
        <div className="truncate text-base font-semibold tabular-nums text-white md:text-lg min-h-[28px] flex items-center">
          {isValueLoading ? (
            <DigitSkeleton units={loadingUnits} heightPx={counterFontSize} />
          ) : normalizedAnimatedValue !== null ? (
            <AnimatedCounter
              value={normalizedAnimatedValue}
              places={placesFor(normalizedAnimatedValue)}
              fontSize={counterFontSize}
              gradientFrom="transparent"
              gradientTo="transparent"
              gradientHeight={0}
              textColor="rgb(255 255 255)"
              fontWeight={600}
              horizontalPadding={0}
              gap={0}
              counterStyle={{ paddingLeft: 0, paddingRight: 0, gap: 0 }}
            />
          ) : (
            value
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-3xs xs4:text-2xs md:text-[11px] leading-4 text-zinc-500">{detail}</p>
      </div>
    </article>
  )
}

function GrossRevenueMetricCard({
  rows,
  showUnavailable,
  isLoading,
}: {
  rows: AdminSelectedUserWorkspaceStatsSnapshot['grossBookedRevenueByCurrency']
  showUnavailable: boolean
  isLoading: boolean
}) {
  const currencyOptions = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        code: row.currency.toUpperCase(),
      })),
    [rows]
  )
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null)
  const selectedOption = useMemo(() => {
    if (currencyOptions.length === 0) return null
    if (!selectedCurrency) return currencyOptions[0]
    return (
      currencyOptions.find((option) => option.currency === selectedCurrency) ??
      currencyOptions[0]
    )
  }, [currencyOptions, selectedCurrency])

  const hasMultipleCurrencies = currencyOptions.length > 1

  const value = showUnavailable
    ? 'Unavailable'
    : selectedOption
      ? formatCurrencyAmount(selectedOption.amountCents, selectedOption.currency)
      : 'No paid revenue'

  const detail = isLoading
    ? 'Loading revenue signals...'
    : showUnavailable
    ? 'Could not load revenue signals.'
    : selectedOption
      ? hasMultipleCurrencies
        ? `Viewing ${selectedOption.code}. Switch currency to inspect exact booked amount.`
        : 'Booked from succeeded paid orders.'
      : 'No succeeded paid-order revenue yet.'

  const footer = isLoading ? (
    <div className="flex justify-center">
      <div className="h-7 w-36 md:w-48 animate-pulse rounded-md bg-white/10" />
    </div>
  ) : showUnavailable ? (
    <p className="truncate text-[10px] text-zinc-500">Revenue signals unavailable</p>
  ) : hasMultipleCurrencies ? (
    <div className="flex justify-center">
      <Select value={selectedOption?.currency ?? ''} onValueChange={setSelectedCurrency}>
        <SelectTrigger
          size="sm"
          className="h-7 w-20 border-zinc-800 bg-black text-[10px] text-zinc-100 hover:bg-white hover:text-black cursor-pointer"
        >
        <SelectValue placeholder="Currency" className="uppercase" />
      </SelectTrigger>
      <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
        {currencyOptions.map((option) => (
          <SelectItem key={option.currency} value={option.currency} className="text-[10px] uppercase">
            <span>{option.code}</span>{' '}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    </div>
  ) : selectedOption ? (
    <div className="inline-flex h-auto w-full items-center rounded-md border border-zinc-700/70 bg-black/20 p-2 text-[10px] uppercase tracking-wide text-zinc-300">
      Currency: {selectedOption.code}
    </div>
  ) : (
    <div className="inline-flex h-auto w-full items-center text-center md:text-start rounded-md border border-zinc-800/80 bg-black/20 p-2 text-[10px] text-zinc-500">
      No paid currency available yet
    </div>
  )

  return (
    <article className="flex h-full min-h-[132px] flex-col rounded-lg border border-zinc-800/80 bg-zinc-950/45 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Gross revenue</p>
        <span className="inline-flex size-6 items-center justify-center rounded-md border border-white/10 bg-black/25 text-zinc-400">
          <CircleDollarSign className="size-3.5" />
        </span>
      </div>

      <div className="mt-1 flex-1">
        <div className="truncate text-base font-semibold tabular-nums text-white md:text-lg min-h-[28px] flex items-center">
          {isLoading ? (
            <div className="h-5 md:h-[22px] w-20 md:w-40 animate-pulse rounded-sm bg-white/10" />
          ) : (
            value
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-3xs xs4:text-2xs md:text-[11px] md:leading-4 text-zinc-500">{detail}</p>
      </div>

      <div className="mt-2 border-t border-white/5 pt-2">
        {footer}
      </div>
    </article>
  )
}

export default function SelectedUserWorkspaceStats({
  stats,
  isLoading,
  hasError,
}: SelectedUserWorkspaceStatsProps) {
  const showUnavailable = hasError && !stats
  const refundsAttention = stats?.refundsAttention ?? 0
  const showLoadingSkeleton = !showUnavailable && (!stats || isLoading)

  const upcomingEventsValue = stats?.upcomingEvents ?? 0
  const paidOrdersValue = stats?.paidOrdersSucceeded ?? 0
  const refundsAttentionValue = stats?.refundsAttention ?? 0

  return (
    <section className="border-b border-zinc-800 px-2 xs4:px-3 py-2 xs4:py-3 md:px-5">
      <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/35 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
              Selected User Snapshot
            </h3>
            {isLoading ? (
              <Loader2 className="size-3.5 animate-spin text-zinc-500" aria-hidden="true" />
            ) : null}
          </div>
          <p className="text-[11px] text-zinc-500">Operational scope</p>
        </div>

        <div className="mt-2.5 grid grid-cols-2 items-stretch gap-2.5 lg:grid-cols-4">
          <MetricCard
            label="Upcoming events"
            value={
              showUnavailable
                ? 'Unavailable'
                : formatInteger(stats?.upcomingEvents ?? 0)
            }
            animatedValue={showUnavailable ? null : upcomingEventsValue}
            isValueLoading={showLoadingSkeleton}
            loadingUnits={digitsForInteger(upcomingEventsValue)}
            detail="Future-dated, non-archived events."
            icon={<CalendarClock className="size-3.5" />}
          />

          <MetricCard
            label="Paid orders"
            value={
              showUnavailable
                ? 'Unavailable'
                : formatInteger(stats?.paidOrdersSucceeded ?? 0)
            }
            animatedValue={showUnavailable ? null : paidOrdersValue}
            isValueLoading={showLoadingSkeleton}
            loadingUnits={digitsForInteger(paidOrdersValue)}
            detail="Succeeded paid-event orders."
            icon={<ReceiptText className="size-3.5" />}
          />

          <GrossRevenueMetricCard
            rows={stats?.grossBookedRevenueByCurrency ?? []}
            showUnavailable={showUnavailable}
            isLoading={showLoadingSkeleton}
          />

          <MetricCard
            label="Refunds attention"
            value={
              showUnavailable
                ? 'Unavailable'
                : formatInteger(refundsAttention)
            }
            animatedValue={showUnavailable ? null : refundsAttentionValue}
            isValueLoading={showLoadingSkeleton}
            loadingUnits={digitsForInteger(refundsAttentionValue)}
            detail={
              showUnavailable
                ? 'Could not load refund signals.'
                : refundsAttention > 0
                  ? 'Requested, processing/approved, or failed.'
                  : 'No pending refund attention.'
            }
            icon={<AlertTriangle className="size-3.5" />}
            emphasize={!showUnavailable && refundsAttention > 0}
          />
        </div>
      </div>
    </section>
  )
}
