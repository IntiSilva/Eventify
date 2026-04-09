"use client"

import { useMemo, useState } from "react"
import { useReducedMotion } from "motion/react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn, formatPrice } from "@/lib/utils"
import type {
  OrganizerOverviewTimeSeriesPoint,
  OrganizerOverviewTimeSeriesSnapshot,
} from "@/lib/data"

type TrendMetric = "gross_revenue" | "paid_orders" | "refund_requests"
type RangeKey = "7d" | "30d"

type ChartDatum = {
  index: number
  date: string
  value: number
}

type SimpleTooltipPayloadItem = {
  value?: number | string
}

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; days: number }> = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
]

const METRIC_OPTIONS: Array<{ key: TrendMetric; label: string }> = [
  { key: "paid_orders", label: "Paid orders" },
  { key: "refund_requests", label: "Refund requests" },
  { key: "gross_revenue", label: "Revenue" },
]

const DEFAULT_REVENUE_CURRENCY = "usd"

interface OrganizerTrendCardProps {
  snapshot: OrganizerOverviewTimeSeriesSnapshot
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatDateLabel(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return dateKey
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatCurrencyAmount(amountCents: number, currency: string): string {
  const formatted = formatPrice(amountCents, currency)
  if (formatted) return formatted
  return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`
}

function getMetricValue(
  point: OrganizerOverviewTimeSeriesPoint,
  metric: TrendMetric,
  currency: string | null
): number {
  if (metric === "paid_orders") return point.paidOrdersSucceeded
  if (metric === "refund_requests") return point.refundRequestsCreated
  if (!currency) return 0
  return point.grossBookedRevenueByCurrency[currency] ?? 0
}

function formatMetricValue(value: number, metric: TrendMetric, currency: string | null): string {
  if (metric === "gross_revenue") {
    if (!currency) return "No currency"
    return formatCurrencyAmount(value, currency)
  }
  return formatInteger(value)
}

function getSeriesColor(metric: TrendMetric): string {
  if (metric === "paid_orders") return "#3b82f6"
  if (metric === "refund_requests") return "#f59e0b"
  return "#10b981"
}

export default function OrganizerTrendCard({ snapshot }: OrganizerTrendCardProps) {
  const [metric, setMetric] = useState<TrendMetric>("paid_orders")
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d")
  const prefersReducedMotion = useReducedMotion()

  const currencies = snapshot.availableCurrencies
  const usdCurrency =
    currencies.find((currency) => currency.toLowerCase() === DEFAULT_REVENUE_CURRENCY) ?? null
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(
    usdCurrency ?? snapshot.defaultCurrency
  )
  const selectedCurrencyOption = selectedCurrency
    ? currencies.find((currency) => currency.toLowerCase() === selectedCurrency.toLowerCase()) ??
      null
    : null
  const effectiveCurrency =
    metric === "gross_revenue"
      ? selectedCurrencyOption ?? usdCurrency ?? currencies[0] ?? null
      : null

  const selectedRange = RANGE_OPTIONS.find((option) => option.key === rangeKey) ?? RANGE_OPTIONS[1]
  const chartSeries: ChartDatum[] = useMemo(
    () =>
      snapshot.points.map((point, index) => ({
        index,
        date: point.date,
        value: getMetricValue(point, metric, effectiveCurrency),
      })),
    [snapshot.points, metric, effectiveCurrency]
  )

  const lastIndex = chartSeries.length - 1
  const startIndex = Math.max(0, lastIndex - (selectedRange.days - 1))
  const visibleSeries = chartSeries.slice(startIndex)

  const totalInRange = useMemo(
    () => visibleSeries.reduce((sum, point) => sum + point.value, 0),
    [visibleSeries]
  )

  const metricColor = getSeriesColor(metric)
  const dateLabelStart = visibleSeries[0]?.date ?? null
  const dateLabelEnd = visibleSeries[visibleSeries.length - 1]?.date ?? null
  const metricLabel = METRIC_OPTIONS.find((option) => option.key === metric)?.label ?? "Activity"

  return (
    <section className="rounded-2xl border border-white/20 bg-zinc-950/62 p-3.5 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_26px_rgba(0,0,0,0.30)] md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Opportunity trend</h3>
          <p className="mt-0.5 text-xs text-zinc-400">
            Track momentum across paid orders, refunds, and revenue.
          </p>
        </div>

        <div className="text-right">
          <p className="text-start md:text-end text-sm font-semibold tabular-nums text-white">
            {formatMetricValue(totalInRange, metric, effectiveCurrency)}
          </p>
          <p className="text-[11px] text-zinc-500">
            {metricLabel} - last {selectedRange.days} days
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-md border border-white/10 bg-black/35 p-0.5">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRangeKey(option.key)}
              className={cn(
                "h-6 rounded px-2 text-[10px] font-medium transition-colors",
                option.key === rangeKey
                  ? "bg-emerald-900/70 text-emerald-100"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Select value={metric} onValueChange={(value) => setMetric(value as TrendMetric)}>
          <SelectTrigger className="h-7 w-[126px] border-zinc-700 bg-black/35 text-[11px] text-zinc-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
            {METRIC_OPTIONS.map((option) => (
              <SelectItem key={option.key} value={option.key} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {metric === "gross_revenue" && currencies.length > 0 ? (
          <Select
            value={effectiveCurrency ?? ""}
            onValueChange={(value) => setSelectedCurrency(value)}
          >
            <SelectTrigger className="h-7 w-[100px] border-zinc-700 bg-black/35 text-[11px] text-zinc-100 uppercase">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
              {currencies.map((currency) => (
                <SelectItem key={currency} value={currency} className="text-xs uppercase">
                  {currency.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="mt-3 h-36 w-full rounded-md border border-white/12 bg-black/24 px-1.5 pb-1 pt-1">
        {visibleSeries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            No trend data available.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartSeries}
              margin={{
                top: 8,
                right: 8,
                left: 6,
                bottom: 0,
              }}
            >
              <defs>
                <linearGradient id="organizer-trend-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={metricColor} stopOpacity={0.24} />
                  <stop offset="95%" stopColor={metricColor} stopOpacity={0.015} />
                </linearGradient>
              </defs>

              <CartesianGrid
                vertical={false}
                stroke="rgba(255,255,255,0.045)"
                strokeDasharray="2 4"
              />

              <XAxis
                type="number"
                dataKey="index"
                domain={[startIndex, Math.max(startIndex, lastIndex)]}
                allowDataOverflow
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tickCount={4}
                minTickGap={32}
                tickMargin={8}
                tick={{ fill: "rgba(161,161,170,0.9)", fontSize: 10 }}
                tickFormatter={(value: number) => {
                  const index = Math.round(value)
                  const point = chartSeries[index]
                  return point ? formatDateLabel(point.date) : ""
                }}
              />

              <Tooltip
                cursor={{
                  stroke: "rgba(255,255,255,0.12)",
                  strokeWidth: 0.8,
                  strokeDasharray: "3 3",
                }}
                content={({ active, payload, label }) => {
                  if (!active) return null

                  const rows = payload as readonly SimpleTooltipPayloadItem[] | undefined
                  const rawValue = rows?.[0]?.value
                  const labelIndex =
                    typeof label === "number"
                      ? Math.round(label)
                      : typeof label === "string"
                        ? Number(label)
                        : -1
                  const labelPoint =
                    Number.isFinite(labelIndex) && labelIndex >= 0
                      ? chartSeries[labelIndex]
                      : undefined
                  const numericValue =
                    typeof rawValue === "number"
                      ? rawValue
                      : typeof rawValue === "string"
                        ? Number(rawValue)
                        : 0

                  return (
                    <div className="rounded-md border border-white/12 bg-zinc-950/88 px-2.5 py-1.5 text-right">
                      <p className="text-[10px] text-zinc-500">
                        {labelPoint ? formatDateLabel(labelPoint.date) : ""}
                      </p>
                      <p className="text-[11px] font-semibold tabular-nums text-zinc-100">
                        {formatMetricValue(
                          Number.isFinite(numericValue) ? numericValue : 0,
                          metric,
                          effectiveCurrency
                        )}
                      </p>
                    </div>
                  )
                }}
              />

              <Area
                type="natural"
                dataKey="value"
                stroke={metricColor}
                strokeWidth={0.95}
                fill="url(#organizer-trend-fill)"
                fillOpacity={1}
                dot={false}
                activeDot={{
                  r: 1.7,
                  fill: metricColor,
                  stroke: "rgba(236, 253, 245, 0.9)",
                  strokeWidth: 0.65,
                }}
                isAnimationActive={!prefersReducedMotion}
                animationDuration={460}
                animationEasing="ease-in-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500">
        <span>{dateLabelStart ? formatDateLabel(dateLabelStart) : "-"}</span>
        <span>{dateLabelEnd ? formatDateLabel(dateLabelEnd) : "-"}</span>
      </div>
    </section>
  )
}
