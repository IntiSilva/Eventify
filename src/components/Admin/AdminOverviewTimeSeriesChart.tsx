"use client"

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn, formatPrice } from "@/lib/utils"
import type {
  AdminOverviewTimeSeriesPoint,
  AdminOverviewTimeSeriesSnapshot,
} from "@/lib/data"

type ChartMetric = "gross_revenue" | "paid_orders" | "refund_requests"
type RangeKey = "7d" | "30d" | "90d"

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
  { key: "90d", label: "90D", days: 90 },
]

const METRIC_OPTIONS: Array<{ key: ChartMetric; label: string }> = [
  { key: "gross_revenue", label: "Gross booked revenue" },
  { key: "paid_orders", label: "Paid orders succeeded" },
  { key: "refund_requests", label: "Refund requests created" },
]
const DEFAULT_REVENUE_CURRENCY = "usd"

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
  point: AdminOverviewTimeSeriesPoint,
  metric: ChartMetric,
  currency: string | null
): number {
  if (metric === "paid_orders") {
    return point.paidOrdersSucceeded
  }

  if (metric === "refund_requests") {
    return point.refundRequestsCreated
  }

  if (!currency) return 0
  return point.grossBookedRevenueByCurrency[currency] ?? 0
}

function formatMetricValue(value: number, metric: ChartMetric, currency: string | null): string {
  if (metric === "gross_revenue") {
    if (!currency) return "No currency"
    return formatCurrencyAmount(value, currency)
  }

  return formatInteger(value)
}

function getMetricFooterText(metric: ChartMetric, currency: string | null): string {
  if (metric === "gross_revenue") {
    const currencyLabel = currency ? currency.toUpperCase() : "selected currency"
    return `Gross booked revenue reflects succeeded paid-event payments (>0) in ${currencyLabel}.`
  }

  if (metric === "paid_orders") {
    return "Paid orders are succeeded paid-event payments with amount greater than zero."
  }

  return "Refund activity counts refund requests created (all sources and statuses)."
}

function getSeriesColor(metric: ChartMetric): {
  stroke: string
  gradientTop: string
  gradientBottom: string
} {
  if (metric === "paid_orders") {
    return {
      stroke: "#4D7DCF",
      gradientTop: "rgba(77, 125, 207, 0.20)",
      gradientBottom: "rgba(77, 125, 207, 0.015)",
    }
  }

  if (metric === "refund_requests") {
    return {
      stroke: "#C07A21",
      gradientTop: "rgba(192, 122, 33, 0.20)",
      gradientBottom: "rgba(192, 122, 33, 0.015)",
    }
  }

  return {
    stroke: "#197962",
    gradientTop: "rgba(25, 121, 98, 0.22)",
    gradientBottom: "rgba(25, 121, 98, 0.015)",
  }
}

type RGBA = {
  r: number
  g: number
  b: number
  a: number
}

function parseColorToRgba(input: string): RGBA | null {
  const value = input.trim()

  if (value.startsWith("#")) {
    const hex = value.slice(1)
    if (hex.length === 3) {
      const r = Number.parseInt(hex[0] + hex[0], 16)
      const g = Number.parseInt(hex[1] + hex[1], 16)
      const b = Number.parseInt(hex[2] + hex[2], 16)
      if ([r, g, b].some(Number.isNaN)) return null
      return { r, g, b, a: 1 }
    }

    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16)
      const g = Number.parseInt(hex.slice(2, 4), 16)
      const b = Number.parseInt(hex.slice(4, 6), 16)
      if ([r, g, b].some(Number.isNaN)) return null
      return { r, g, b, a: 1 }
    }

    return null
  }

  const match = value.match(/^rgba?\(([^)]+)\)$/i)
  if (!match) return null

  const parts = match[1].split(",").map((part) => part.trim())
  if (parts.length < 3) return null

  const r = Number(parts[0])
  const g = Number(parts[1])
  const b = Number(parts[2])
  const a = parts.length >= 4 ? Number(parts[3]) : 1
  if ([r, g, b, a].some((entry) => Number.isNaN(entry))) return null

  return { r, g, b, a }
}

function interpolateRgba(from: RGBA, to: RGBA, progress: number): RGBA {
  const t = Math.max(0, Math.min(1, progress))
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: from.a + (to.a - from.a) * t,
  }
}

function toRgbaString(color: RGBA): string {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${Math.max(
    0,
    Math.min(1, color.a)
  ).toFixed(3)})`
}

function useInterpolatedSeriesColor(
  target: ReturnType<typeof getSeriesColor>,
  durationMs = 320
): ReturnType<typeof getSeriesColor> {
  const [animated, setAnimated] = useState(target)
  const fromRef = useRef(target)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const from = fromRef.current
    if (
      from.stroke === target.stroke &&
      from.gradientTop === target.gradientTop &&
      from.gradientBottom === target.gradientBottom
    ) {
      fromRef.current = target
      return
    }

    const fromStroke = parseColorToRgba(from.stroke)
    const toStroke = parseColorToRgba(target.stroke)
    const fromTop = parseColorToRgba(from.gradientTop)
    const toTop = parseColorToRgba(target.gradientTop)
    const fromBottom = parseColorToRgba(from.gradientBottom)
    const toBottom = parseColorToRgba(target.gradientBottom)

    if (
      !fromStroke ||
      !toStroke ||
      !fromTop ||
      !toTop ||
      !fromBottom ||
      !toBottom
    ) {
      let cancelled = false
      const commit = () => {
        if (cancelled) return
        setAnimated(target)
        fromRef.current = target
      }
      if (typeof queueMicrotask === "function") queueMicrotask(commit)
      else Promise.resolve().then(commit)
      return () => {
        cancelled = true
      }
    }

    const startTime = performance.now()

    const step = (now: number) => {
      const elapsed = now - startTime
      const linearProgress = Math.max(0, Math.min(1, elapsed / durationMs))
      const easedProgress = 1 - Math.pow(1 - linearProgress, 3)

      const nextAnimated = {
        stroke: toRgbaString(interpolateRgba(fromStroke, toStroke, easedProgress)),
        gradientTop: toRgbaString(interpolateRgba(fromTop, toTop, easedProgress)),
        gradientBottom: toRgbaString(interpolateRgba(fromBottom, toBottom, easedProgress)),
      }

      setAnimated(nextAnimated)
      fromRef.current = nextAnimated

      if (linearProgress < 1) {
        frameRef.current = window.requestAnimationFrame(step)
      } else {
        fromRef.current = target
        frameRef.current = null
      }
    }

    frameRef.current = window.requestAnimationFrame(step)

    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [target, durationMs])

  return animated
}

type AdminOverviewTimeSeriesChartProps = {
  snapshot: AdminOverviewTimeSeriesSnapshot
}

export default function AdminOverviewTimeSeriesChart({
  snapshot,
}: AdminOverviewTimeSeriesChartProps) {
  const router = useRouter()
  const [isRefreshing, startRefreshTransition] = useTransition()
  const [metric, setMetric] = useState<ChartMetric>("gross_revenue")
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d")
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(() => {
    const usdCurrency = snapshot.availableCurrencies.find(
      (currency) => currency.toLowerCase() === DEFAULT_REVENUE_CURRENCY
    )
    return usdCurrency ?? snapshot.defaultCurrency
  })

  const gradientId = useId().replace(/:/g, "")

  const currencies = snapshot.availableCurrencies
  const usdCurrency =
    currencies.find((currency) => currency.toLowerCase() === DEFAULT_REVENUE_CURRENCY) ?? null
  const selectedCurrencyOption = selectedCurrency
    ? currencies.find((currency) => currency.toLowerCase() === selectedCurrency.toLowerCase()) ??
      null
    : null
  const effectiveCurrency =
    metric === "gross_revenue"
      ? selectedCurrencyOption ?? usdCurrency ?? currencies[0] ?? null
      : null
  const currencySelectOptions = usdCurrency
    ? [usdCurrency, ...currencies.filter((currency) => currency.toLowerCase() !== DEFAULT_REVENUE_CURRENCY)]
    : currencies

  const selectedRange =
    RANGE_OPTIONS.find((option) => option.key === rangeKey) ?? RANGE_OPTIONS[1]

  const chartSeries: ChartDatum[] = useMemo(() => {
    return snapshot.points.map((point, index) => ({
      index,
      date: point.date,
      value: getMetricValue(point, metric, effectiveCurrency),
    }))
  }, [effectiveCurrency, metric, snapshot.points])

  const lastIndex = chartSeries.length - 1
  const startIndex = Math.max(0, lastIndex - (selectedRange.days - 1))
  const visibleSeries = chartSeries.slice(startIndex)

  const totalInRange = useMemo(
    () => visibleSeries.reduce((sum, point) => sum + point.value, 0),
    [visibleSeries]
  )

  const targetMetricColor = useMemo(() => getSeriesColor(metric), [metric])
  const metricColor = useInterpolatedSeriesColor(targetMetricColor)

  const dateLabelStart = visibleSeries[0]?.date ?? null
  const dateLabelMiddle =
    visibleSeries.length > 2
      ? visibleSeries[Math.floor(visibleSeries.length / 2)]?.date ?? null
      : null
  const dateLabelEnd = visibleSeries[visibleSeries.length - 1]?.date ?? null
  const refreshMetricLabel =
    METRIC_OPTIONS.find((option) => option.key === metric)?.label ?? metric
  const refreshContextLabel =
    metric === "gross_revenue" && effectiveCurrency
      ? `${refreshMetricLabel} in ${effectiveCurrency.toUpperCase()}`
      : refreshMetricLabel

  const handleRefreshChartView = () => {
    startRefreshTransition(() => {
      router.refresh()
    })
  }

  return (
    <Card className="mt-2.5 gap-0 border border-zinc-800/90 bg-gradient-to-b from-zinc-900/75 to-zinc-950/75 py-0 shadow-none">
      <CardHeader className="px-3.5 pb-2 pt-3">
        <CardDescription className="text-[10px] uppercase tracking-wide text-zinc-500">
          Money in motion
        </CardDescription>
        <CardTitle className="text-sm font-semibold text-white">
          Daily activity snapshot
        </CardTitle>

        <CardAction>
          <div className="flex flex-col md:flex-row items-end md:items-center gap-1 md:gap-2">
            <div className="inline-flex items-center rounded-md border border-white/10 bg-black/25 p-0.5">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setRangeKey(option.key)}
                  className={cn(
                    "h-6 rounded px-2 text-[10px] font-medium transition-colors",
                    option.key === rangeKey
                      ? "bg-emerald-900/65 text-emerald-100"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleRefreshChartView}
              disabled={isRefreshing}
              aria-label={`Refresh chart data for ${refreshContextLabel} over the last ${selectedRange.days} days`}
              className="h-7 gap-1.5 border border-white/10 bg-black/25 px-2 text-[10px] font-medium text-zinc-200 hover:bg-black/40 hover:text-white"
            >
              {isRefreshing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              <span className="hidden md:inline">Refresh</span>
            </Button>
          </div>
        </CardAction>

        <div className="col-span-2 mt-1 flex flex-wrap items-center gap-2">
          <Select
            value={metric}
            onValueChange={(value) => setMetric(value as ChartMetric)}
          >
            <SelectTrigger
              size="sm"
              className="flex border-zinc-700 bg-black/30 text-xs text-zinc-100 hover:bg-black/40 hover:text-zinc-100"
            >
              <SelectValue placeholder="Metric" />
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
              <SelectTrigger
                size="sm"
                className="flex border-zinc-700 bg-black/30 text-xs text-zinc-100 hover:bg-black/40 hover:text-zinc-100"
              >
                <SelectValue placeholder="Currency" className="uppercase" />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
                {currencySelectOptions.map((currency) => (
                  <SelectItem
                    key={currency}
                    value={currency}
                    className="text-xs uppercase"
                  >
                    {currency.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <div className="ml-auto text-right">
            <p className="text-sm font-semibold tabular-nums text-white">
              {formatMetricValue(totalInRange, metric, effectiveCurrency)}
            </p>
            <p className="text-[10px] text-zinc-500">
              Last {selectedRange.days} days
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-3.5 pb-2 pt-0">
        {visibleSeries.length === 0 ? (
          <div className="flex h-36 items-center justify-center rounded-md border border-white/10 bg-black/20 text-xs text-zinc-500">
            No chart data available.
          </div>
        ) : (
          <>
            <div className="h-36 w-full rounded-md border border-white/8 bg-black/20 px-1.5 pb-1 pt-1">
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
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="3%" stopColor={metricColor.gradientTop} />
                      <stop offset="97%" stopColor={metricColor.gradientBottom} />
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
                      stroke: "rgba(255,255,255,0.13)",
                      strokeWidth: 0.7,
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
                        <div className="rounded-md border border-white/12 bg-zinc-950/88 px-2.5 py-1.5 text-right shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
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
                    stroke={metricColor.stroke}
                    strokeWidth={0.86}
                    fill={`url(#${gradientId})`}
                    fillOpacity={1}
                    dot={false}
                    activeDot={{
                      r: 1.55,
                      fill: metricColor.stroke,
                      stroke: "rgba(236, 253, 245, 0.9)",
                      strokeWidth: 0.65,
                    }}
                    isAnimationActive
                    animationBegin={0}
                    animationDuration={540}
                    animationEasing="ease-in-out"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500">
              <span>{dateLabelStart ? formatDateLabel(dateLabelStart) : "-"}</span>
              <span>{dateLabelMiddle ? formatDateLabel(dateLabelMiddle) : "-"}</span>
              <span>{dateLabelEnd ? formatDateLabel(dateLabelEnd) : "-"}</span>
            </div>
          </>
        )}
      </CardContent>

      <CardFooter className="border-t border-white/5 px-3.5 py-2">
        <p className="text-[11px] text-zinc-500">
          {getMetricFooterText(metric, effectiveCurrency)} Daily buckets use UTC
          dates.
        </p>
      </CardFooter>
    </Card>
  )
}
