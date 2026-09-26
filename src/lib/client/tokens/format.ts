/** Date arithmetic and every number-to-text rule the dashboard prints. */
import type { MetricKey } from "./schema"

/* Dates ------------------------------------------------------------- */

const noon = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00Z`)

/** Shift an ISO day by whole days; anchoring at noon UTC is DST-proof. */
export const shiftDays = (day: string, delta: number) => {
  const date = noon(day)
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const

/* Formatting --------------------------------------------------------- */

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const exact = new Intl.NumberFormat("en-US")
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})
const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})
const dayLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})
const dateLabel = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})
const weekdayLabel = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})
/**
 * Quota instants are real moments, not the day strings the formatters
 * above anchor at noon UTC — so they are the one thing on this page that
 * needs a real zone. It is the collector's (cf-workers-api's TIME_ZONE),
 * which is also the zone every calendar day here is bucketed in: a reset
 * time rendered in the visitor's zone would disagree with the day
 * boundaries drawn right above it.
 */
const COLLECTOR_ZONE = "Asia/Shanghai"

const zonedDay = new Intl.DateTimeFormat("en-US", {
  timeZone: COLLECTOR_ZONE,
  month: "short",
  day: "numeric",
})

// Split from the day rather than asked for in one call, which would
// render as "Aug 8 at 21:28".
const zonedTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: COLLECTOR_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const monthName = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})
const monthTitle = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

export const formatTokens = (value: number) => compact.format(value)

export const formatExact = (value: number) => exact.format(value)

/** Counts stay exact while they're readable, then fall back to compact. */
export const formatCount = (value: number) =>
  value < 100_000 ? exact.format(value) : compact.format(value)

/** Cents matter for small amounts, noise for large ones. */
export const formatCost = (value: number) =>
  (value >= 100 ? usdWhole : usd).format(value)

export const formatCostExact = (value: number) => usd.format(value)

export const formatMetric = (value: number, metric: MetricKey) =>
  metric === "cost" ? formatCost(value) : formatTokens(value)

export const formatShare = (ratio: number) => {
  if (!Number.isFinite(ratio)) return "—"
  const pct = ratio * 100
  if (pct > 0 && pct < 0.1) return "<0.1%"
  if (pct >= 99.95) return "100%"
  return `${pct.toFixed(1)}%`
}

/** "Jul 12" */
export const formatDay = (day: string) => dayLabel.format(noon(day))

/** "Jul 12, 2026" */
export const formatDate = (day: string) => dateLabel.format(noon(day))

/** "Sun, Jul 12" — a picked day, where the weekday is half the answer. */
export const formatWeekdayDay = (day: string) => weekdayLabel.format(noon(day))

/** "Aug 8, 21:28" — an absolute instant, in the collector's zone. */
export const formatInstant = (iso: string) => {
  const at = new Date(iso)
  return `${zonedDay.format(at)}, ${zonedTime.format(at)}`
}

/** "May ’25" — compact axis label for monthly buckets. */
export const formatMonth = (month: string) =>
  `${monthName.format(noon(`${month}-15`))} ’${month.slice(2, 4)}`

/** "May 2025" */
export const formatMonthTitle = (month: string) =>
  monthTitle.format(noon(`${month}-15`))

/** "just now" / "5m ago" / "3h ago" / "2d ago" — for device sync times. */
export const formatAgo = (epochMs: number, now = Date.now()) => {
  const minutes = Math.round((now - epochMs) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / (60 * 24))}d ago`
}

/**
 * "4m" / "1h 8m" / "3d 4h" — how long until an instant that lies ahead:
 * the quota windows and reset credits, the only such instants on this
 * page. An instant that has already passed returns null: a rate-limit
 * window that reset is not "-1h" away, it is a different state, and the
 * caller says so in words.
 *
 * Two units, not one: "1h" for a session that resets in 1h 59m is off
 * by half the answer. A zero second unit is dropped ("3h").
 *
 * Rounds *down*, unlike formatAgo. These are deadlines, and rounding a
 * credit that lapses in five and a half days up to "6d" tells the reader
 * they have a day they do not have. Under a minute still reads "1m"
 * rather than "0m" — it has not expired yet, which is the only thing
 * null is allowed to mean here.
 */
export const formatRemaining = (epochMs: number, now = Date.now()) => {
  const ms = epochMs - now
  if (ms <= 0) return null
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const pair = (major: number, unit: string, minor: number, sub: string) =>
    minor > 0 ? `${major}${unit} ${minor}${sub}` : `${major}${unit}`
  const hours = Math.floor(minutes / 60)
  return hours < 24
    ? pair(hours, "h", minutes % 60, "m")
    : pair(Math.floor(hours / 24), "d", hours % 24, "h")
}

/** "in 4m" / "in 1h 8m" / "in 3d 4h" — formatRemaining, as a phrase. */
export const formatIn = (epochMs: number, now = Date.now()) => {
  const remaining = formatRemaining(epochMs, now)
  return remaining === null ? null : `in ${remaining}`
}

/** "42 min" / "9.5 h" — for CLI-reported active time. */
export const formatDuration = (ms: number) => {
  const minutes = ms / 60_000
  if (minutes < 1) return "<1 min"
  if (minutes < 90) return `${Math.round(minutes)} min`
  return `${(minutes / 60).toFixed(1)} h`
}

/**
 * "↑ 23%" / "↓ 8%" / "→ 0%" for period-over-period change; beyond +200%
 * it switches to the new-to-old multiple ("↑ 3.4×") which stays readable
 * where percentages get silly.
 */
export const formatDelta = (ratio: number) => {
  const pct = Math.abs(ratio) * 100
  const arrow = ratio > 0.0005 ? "↑" : ratio < -0.0005 ? "↓" : "→"
  const magnitude =
    ratio >= 2
      ? `${(ratio + 1).toFixed(1)}×`
      : `${pct.toFixed(pct < 10 ? 1 : 0)}%`
  return `${arrow} ${magnitude}`
}

/** Cached payloads still age against the reader's clock. */
export const isOnline = (
  lastSeen: number | null,
  withinMs: number,
  now = Date.now(),
) => lastSeen !== null && now - lastSeen < withinMs
