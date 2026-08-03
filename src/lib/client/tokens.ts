/**
 * Data layer for the Tokens dashboard: types for the collector's
 * /api/site view (see tokens-worker/src/site.ts) plus the pure date,
 * aggregation and formatting helpers the renderers in
 * ./tokens-dashboard/ draw from. Pure and browser-safe — this module
 * never touches the DOM, which is what keeps it testable.
 */

import { fetchJson, swr } from "./feed"
import { weekdayIndex } from "./heatmap"

export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  tokens: number
  messages: number
  cost: number
}

/** Usage span of a breakdown row inside its range. */
export type UsageSpan = {
  days: number
  firstDate: string | null
  lastDate: string | null
}

export type SiteRange = {
  from: string | null
  totals: Usage & {
    activeDays: number
    firstDate: string | null
    lastDate: string | null
  }
  byModel: (Usage & UsageSpan & { model: string; providers: string })[]
  byClient: (Usage & UsageSpan & { client: string })[]
  byProvider: (Usage & UsageSpan & { provider: string })[]
}

export type DaySlice = { tokens: number; cost: number }

export type SiteDay = {
  date: string
  tokens: number
  cost: number
  messages: number
  /** Wall-clock active time (ms) summed across devices; only present on
   *  days the CLI reported it. */
  active?: number
  providers: Record<string, DaySlice>
  clients: Record<string, DaySlice>
}

export type SiteDevice = {
  name: string
  firstSeen: number | null
  lastSeen: number | null
  cliVersion: string | null
  sessions: number | null
  activeMs: number | null
  longestMs: number | null
  maxConcurrent: number | null
  mcpServers: string[] | null
  activeDays: number
  tokens: number
  messages: number
  cost: number
}

export type Site = {
  schemaVersion: number
  generatedAt: string
  today: string
  ranges: Record<RangeKey, SiteRange>
  daily: SiteDay[]
  devices: SiteDevice[]
}

/**
 * The /api/site schema version this dashboard was built against. The
 * collector stamps its payload (`schemaVersion`, SITE_VERSION in
 * tokens-worker/src/site.ts) and bumps it on any shape or semantics
 * change; isSite rejects versions this build does not know, so a stale
 * cache or a mid-deploy mismatch falls back to a refetch (or the
 * fallback UI) instead of a renderer crash. Bump both sides together,
 * and refresh the fixture in tokens.test.ts.
 */
export const SITE_SCHEMA_VERSION = 6

/**
 * The versions this build can decode. Producer and consumer live in
 * separate repos with independent deploys, so a contract bump has no
 * atomic moment: whichever ships first spends a minute or two talking
 * to the other side's previous version, and visitors without a session
 * cache see the fallback for that window. Widening this set is how the
 * window closes — during a rollout list both versions here and ship the
 * homepage *first*, so it already understands the new payload when the
 * collector starts sending it; prune the old entry afterwards. It only
 * works for a shape both readers can survive: the structural checks
 * below still have to pass, and every renderer must tolerate what the
 * older payload omits.
 */
const ACCEPTED_SCHEMA_VERSIONS = new Set([SITE_SCHEMA_VERSION])

export type RangeKey = "day" | "week" | "month" | "quarter" | "all"
export type MetricKey = "tokens" | "cost"

/**
 * The ranges the selector offers. `day` is deliberately not among them:
 * it is the collector's today-only window, and it backs the standalone
 * Today section (the only per-model split of a single day the payload
 * carries) rather than the range-driven parts of the page.
 */
export const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "week", label: "7 days", days: 7 },
  { key: "month", label: "30 days", days: 30 },
  { key: "quarter", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
]

/** Every range key the payload carries — what the decoder validates. */
export const RANGE_KEYS: RangeKey[] = ["day", ...RANGES.map(({ key }) => key)]

/** The five token categories, in display order (shade 1…5). */
export const COMPOSITION: { key: keyof Usage; label: string }[] = [
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
  { key: "reasoning", label: "Reasoning" },
]

/* Payload decoding ---------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

/**
 * Calendar days are not merely strings to the renderers: they are fed
 * to `shiftDays` and `formatDate`, where anything Date can't parse
 * becomes an Invalid Date — and `toISOString()` on one *throws*, which
 * would take down a render the decoder exists to protect. The producer
 * enforces the same shape on the way in (tokens-worker: DATE_RE).
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const isCalendarDay = (value: unknown): value is string =>
  typeof value === "string" && DATE_RE.test(value)

const isDateOrNull = (value: unknown): boolean =>
  value === null || isCalendarDay(value)

/** The full metric set every totals object and breakdown row carries. */
const hasUsage = (row: Record<string, unknown>): boolean =>
  COMPOSITION.every(({ key }) => isCount(row[key])) &&
  isCount(row.tokens) &&
  isCount(row.messages) &&
  isCount(row.cost)

const isSpanRow = (value: unknown, id: string): boolean =>
  isRecord(value) &&
  typeof value[id] === "string" &&
  hasUsage(value) &&
  isCount(value.days) &&
  isDateOrNull(value.firstDate) &&
  isDateOrNull(value.lastDate)

/** A daily providers/clients map the trend chart Object.entries() over. */
const isSlices = (value: unknown): boolean =>
  isRecord(value) &&
  Object.values(value).every(
    (slice) => isRecord(slice) && isCount(slice.tokens) && isCount(slice.cost),
  )

const isDay = (value: unknown): boolean =>
  isRecord(value) &&
  isCalendarDay(value.date) &&
  isCount(value.tokens) &&
  isCount(value.cost) &&
  isCount(value.messages) &&
  (value.active === undefined || isCount(value.active)) &&
  isSlices(value.providers) &&
  isSlices(value.clients)

const isCountOrNull = (value: unknown): boolean =>
  value === null || isCount(value)

/**
 * Device rows are validated in full. The metadata fields render behind
 * truthiness guards, but their types still matter: a string mcpServers
 * has a truthy .length and no .join() — exactly the malformed-cache
 * crash this decoder exists to keep away from the renderers.
 */
const isDevice = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.name === "string" &&
  isCountOrNull(value.firstSeen) &&
  isCountOrNull(value.lastSeen) &&
  (value.cliVersion === null || typeof value.cliVersion === "string") &&
  isCountOrNull(value.sessions) &&
  isCountOrNull(value.activeMs) &&
  isCountOrNull(value.longestMs) &&
  isCountOrNull(value.maxConcurrent) &&
  (value.mcpServers === null ||
    (Array.isArray(value.mcpServers) &&
      value.mcpServers.every((item) => typeof item === "string"))) &&
  isCount(value.activeDays) &&
  isCount(value.tokens) &&
  isCount(value.messages) &&
  isCount(value.cost)

const isRange = (value: unknown): boolean =>
  isRecord(value) &&
  isDateOrNull(value.from) &&
  isRecord(value.totals) &&
  hasUsage(value.totals) &&
  isCount(value.totals.activeDays) &&
  isDateOrNull(value.totals.firstDate) &&
  isDateOrNull(value.totals.lastDate) &&
  Array.isArray(value.byModel) &&
  value.byModel.every(
    (row) =>
      isSpanRow(row, "model") &&
      typeof (row as Record<string, unknown>).providers === "string",
  ) &&
  Array.isArray(value.byClient) &&
  value.byClient.every((row) => isSpanRow(row, "client")) &&
  Array.isArray(value.byProvider) &&
  value.byProvider.every((row) => isSpanRow(row, "provider"))

/**
 * Runtime decoder for the /api/site payload, strict over every field
 * the renderers actually read: the schema version (anything this build
 * does not accept is rejected outright), all five ranges with their
 * totals and breakdown rows (metrics + usage spans), every daily row
 * including the providers/clients slice maps the trend chart iterates,
 * and the device list down to its nullable metadata —
 * render-site truthiness guards handle absence, not wrong types. Dates
 * are held to the calendar-day shape and `generatedAt` to something
 * Date can actually parse: both are arithmetic inputs, not labels.
 */
export function isSite(data: unknown): data is Site {
  if (!isRecord(data)) return false
  const ranges = data.ranges
  return (
    typeof data.schemaVersion === "number" &&
    ACCEPTED_SCHEMA_VERSIONS.has(data.schemaVersion) &&
    typeof data.generatedAt === "string" &&
    Number.isFinite(Date.parse(data.generatedAt)) &&
    isCalendarDay(data.today) &&
    isRecord(ranges) &&
    RANGE_KEYS.every((key) => isRange(ranges[key])) &&
    Array.isArray(data.daily) &&
    data.daily.every(isDay) &&
    Array.isArray(data.devices) &&
    data.devices.every(isDevice)
  )
}

/**
 * One request for the whole page. Unlike the leisurely feeds this one
 * is freshness-critical, so it takes the stale-while-revalidate path:
 * a session-cached copy (any age) is delivered synchronously for an
 * instant first paint, then the network answer follows — cheap, since
 * the collector revalidates by ETag and an unchanged payload is a
 * ~0-byte 304 out of the browser's HTTP cache. The build's own schema
 * version is part of the cache key, so a deploy that bumps the contract
 * never even reads the previous build's entries (an entry it can no
 * longer decode is dropped by isSite anyway — belt and braces).
 */
export const loadSite = (
  endpoint: string,
  onSite: (site: Site) => void,
): Promise<void> =>
  swr(
    `tokens:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => fetchJson<Site>(`${endpoint}/api/site`),
    isSite,
    onSite,
  )

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

/**
 * Each device's CLI resubmits every ~30 minutes, so anything seen
 * within the last 45 is a live reporter (the slack absorbs a delayed
 * run and KV's ≤30 s propagation).
 */
export const isOnline = (lastSeen: number | null, now = Date.now()) =>
  lastSeen !== null && now - lastSeen < 45 * 60_000

/* Aggregation --------------------------------------------------------- */

/**
 * True when the day saw any activity. Early-2025 Cursor logs carry message
 * counts but no token usage (the metadata was never recorded upstream), so
 * `tokens === 0 && messages > 0` days are real activity — streaks and
 * active-day counts must not treat them as idle.
 */
export const hasActivity = (day: Pick<SiteDay, "tokens" | "messages">) =>
  day.tokens > 0 || day.messages > 0

/** Real activity, but no token metadata to size it with. */
export const isMessagesOnly = (day: Pick<SiteDay, "tokens" | "messages">) =>
  day.tokens === 0 && day.messages > 0

/** The API omits idle days entirely; charts and streaks need them back. */
export function fillDaily(
  daily: SiteDay[],
  from: string,
  to: string,
): SiteDay[] {
  const byDate = new Map(daily.map((day) => [day.date, day]))
  const days: SiteDay[] = []
  for (let date = from; date <= to; date = shiftDays(date, 1)) {
    days.push(
      byDate.get(date) ?? {
        date,
        tokens: 0,
        cost: 0,
        messages: 0,
        providers: {},
        clients: {},
      },
    )
  }
  return days
}

/** Sentinel for the residual stack segment. */
export const OTHER = "other"

/** The two dimensions the daily series is sliced by. */
export type StackDim = "provider" | "client"

/** A trend-chart stacking: dimension plus the ids that get own colors. */
export type Stack = { dim: StackDim; ids: string[] }

/**
 * The ids worth their own color when stacking the trend chart by `dim`:
 * the top few by all-time tokens; everything else collapses into "other".
 */
export function stackFor(site: Site, dim: StackDim, limit = 3): Stack {
  const all = site.ranges.all
  const named = (
    dim === "provider"
      ? all.byProvider.map((entry) => entry.provider)
      : all.byClient.map((entry) => entry.client)
  )
    .filter((id) => id && id !== "unknown")
    .slice(0, limit)
  return { dim, ids: [...named, OTHER] }
}

export const stackLabel = (dim: StackDim, id: string) =>
  dim === "provider" ? providerLabel(id) : clientLabel(id)

const daySlices = (day: SiteDay, dim: StackDim) =>
  dim === "provider" ? day.providers : day.clients

export type Bucket = {
  label: string
  title: string
  tokens: number
  cost: number
  messages: number
  /** Aligned with the id order of the stack passed to the bucket builders. */
  segments: number[]
}

const emptyBucket = (label: string, title: string, stack: Stack): Bucket => ({
  label,
  title,
  tokens: 0,
  cost: 0,
  messages: 0,
  segments: stack.ids.map(() => 0),
})

const addDay = (
  bucket: Bucket,
  day: SiteDay,
  stack: Stack,
  metric: MetricKey,
) => {
  bucket.tokens += day.tokens
  bucket.cost += day.cost
  bucket.messages += day.messages
  let named = 0
  for (const [id, slice] of Object.entries(daySlices(day, stack.dim))) {
    const index = stack.ids.indexOf(id)
    if (index >= 0) {
      bucket.segments[index] += slice[metric]
      named += slice[metric]
    }
  }
  // Residual: ids below the stack cutoff (float-safe clamp).
  bucket.segments[stack.ids.length - 1] += Math.max(0, day[metric] - named)
}

export const dailyBuckets = (
  days: SiteDay[],
  stack: Stack,
  metric: MetricKey,
): Bucket[] =>
  days.map((day) => {
    const bucket = emptyBucket(formatDay(day.date), formatDate(day.date), stack)
    addDay(bucket, day, stack, metric)
    return bucket
  })

/** All-time series collapsed to calendar months, idle months included. */
export function monthlyBuckets(
  daily: SiteDay[],
  today: string,
  stack: Stack,
  metric: MetricKey,
): Bucket[] {
  if (daily.length === 0) return []
  const byMonth = new Map<string, Bucket>()
  for (const day of daily) {
    const key = day.date.slice(0, 7)
    let bucket = byMonth.get(key)
    if (!bucket) {
      bucket = emptyBucket(formatMonth(key), formatMonthTitle(key), stack)
      byMonth.set(key, bucket)
    }
    addDay(bucket, day, stack, metric)
  }
  const first = [...byMonth.keys()].sort()[0]
  const last = today.slice(0, 7)
  const months: Bucket[] = []
  for (let key = first; key <= last; key = nextMonth(key)) {
    months.push(
      byMonth.get(key) ??
        emptyBucket(formatMonth(key), formatMonthTitle(key), stack),
    )
  }
  return months
}

const nextMonth = (month: string) => {
  const [year, m] = month.split("-").map(Number)
  return m === 12
    ? `${year + 1}-01`
    : `${year}-${String(m + 1).padStart(2, "0")}`
}

/**
 * Sums over a [from, to] date window of the sparse daily series — the
 * "previous period" comparisons only need totals, so idle days can stay
 * missing.
 */
export function windowTotals(daily: SiteDay[], from: string, to: string) {
  const totals = { tokens: 0, cost: 0, messages: 0, activeDays: 0 }
  for (const day of daily) {
    if (day.date < from || day.date > to) continue
    totals.tokens += day.tokens
    totals.cost += day.cost
    totals.messages += day.messages
    if (hasActivity(day)) totals.activeDays += 1
  }
  return totals
}

/** Total CLI-reported active time (ms) and how many days carried it. */
export function activeTotals(daily: SiteDay[]) {
  let ms = 0
  let days = 0
  for (const day of daily) {
    if (day.active && day.active > 0) {
      ms += day.active
      days += 1
    }
  }
  return { ms, days }
}

/* Today --------------------------------------------------------------- */

/** Clients that keep their own segment in the Today mix; the tail merges. */
const MIX_SEGMENTS = 4
const TOP_MODELS = 5

export type TodayView = {
  /** Nothing recorded yet — the section collapses to a single line
   *  rather than showing a wall of zeroes. */
  idle: boolean
  totals: SiteRange["totals"]
  /** CLI-reported active time today (ms), 0 where none was reported. */
  active: number
  /** Yesterday, the baseline every delta is measured against. */
  before: ReturnType<typeof windowTotals> & { active: number }
  /** Client mix as bar segments; empty when the day has no tokens to
   *  apportion (a message- or active-time-only day is not idle, but it
   *  has no breakdown either). */
  mix: { id: string; label: string; tokens: number; share: number }[]
  models: SiteRange["byModel"]
}

/**
 * Everything the Today section shows, derived in one pass so the
 * renderer only writes DOM: the collector's own today window
 * (`ranges.day` — the payload's only per-model split of a single day),
 * yesterday as the baseline, and the day's client mix and top models.
 *
 * "Nothing logged" means nothing at all, not merely no tokens: cost and
 * CLI-reported active time are stored and displayed independently of
 * token counts, and a day carrying only one of them would otherwise
 * hide the very card that has something to say.
 */
export function todayView(site: Site): TodayView {
  const { totals, byClient, byModel } = site.ranges.day
  const eve = shiftDays(site.today, -1)
  const dayOf = (date: string) => site.daily.find((day) => day.date === date)
  const active = dayOf(site.today)?.active ?? 0

  const clients = byClient.filter((row) => row.tokens > 0)
  const tail = clients
    .slice(MIX_SEGMENTS)
    .reduce((sum, row) => sum + row.tokens, 0)
  const mix =
    totals.tokens > 0
      ? [
          ...clients.slice(0, MIX_SEGMENTS).map((row) => ({
            id: row.client,
            tokens: row.tokens,
          })),
          ...(tail > 0 ? [{ id: OTHER, tokens: tail }] : []),
        ].map(({ id, tokens }) => ({
          id,
          label: clientLabel(id),
          tokens,
          share: tokens / totals.tokens,
        }))
      : []

  return {
    idle:
      totals.tokens === 0 &&
      totals.messages === 0 &&
      totals.cost === 0 &&
      active === 0,
    totals,
    active,
    before: {
      ...windowTotals(site.daily, eve, eve),
      active: dayOf(eve)?.active ?? 0,
    },
    mix,
    models: byModel
      .filter((row) => row.tokens > 0 && !HIDDEN_MODELS.has(row.model))
      .slice(0, TOP_MODELS),
  }
}

export type WeekdayStat = {
  /** Monday-based index, aligned with WEEKDAYS. */
  weekday: number
  average: number
  total: number
  /** How many of this weekday the window contains. */
  occurrences: number
  activeDays: number
}

/**
 * Average consumption per weekday over a dense daily series. Idle days
 * count toward the divisor — the profile answers "what does a typical
 * Monday cost", not "what does an active Monday cost".
 */
export function weekdayProfile(
  days: SiteDay[],
  metric: MetricKey,
): WeekdayStat[] {
  const stats: WeekdayStat[] = WEEKDAYS.map((_, weekday) => ({
    weekday,
    average: 0,
    total: 0,
    occurrences: 0,
    activeDays: 0,
  }))
  for (const day of days) {
    const stat = stats[weekdayIndex(day.date)]
    stat.total += day[metric]
    stat.occurrences += 1
    if (hasActivity(day)) stat.activeDays += 1
  }
  for (const stat of stats) {
    stat.average = stat.occurrences > 0 ? stat.total / stat.occurrences : 0
  }
  return stats
}

export type Facts = {
  biggest: SiteDay | null
  /** Calendar week (Monday-based) with the most tokens. */
  busiestWeek: { from: string; to: string; tokens: number } | null
  /** Median tokens across active days — the "typical" day. */
  median: number | null
  weekday: { name: string; share: number } | null
  longest: { length: number; from: string; to: string } | null
  current: { length: number; since: string } | null
}

/**
 * Fun stats over the dense daily series. Streaks count any activity
 * (message-only days included); the size-based facts (biggest, median,
 * weekday, busiest week) stay token-based since that is what they measure.
 */
export function computeFacts(days: SiteDay[]): Facts {
  let biggest: SiteDay | null = null
  const byWeekday = [0, 0, 0, 0, 0, 0, 0]
  let total = 0
  let longest: Facts["longest"] = null
  let run = 0
  let runStart = ""
  let busiestWeek: Facts["busiestWeek"] = null
  let week: { from: string; to: string; tokens: number } | null = null
  const active: number[] = []

  for (const day of days) {
    total += day.tokens
    byWeekday[weekdayIndex(day.date)] += day.tokens
    if (day.tokens > 0) active.push(day.tokens)
    if (day.tokens > (biggest?.tokens ?? 0)) biggest = day
    if (hasActivity(day)) {
      if (run === 0) runStart = day.date
      run += 1
      if (!longest || run > longest.length)
        longest = { length: run, from: runStart, to: day.date }
    } else {
      run = 0
    }
    if (!week || weekdayIndex(day.date) === 0) {
      week = { from: day.date, to: day.date, tokens: 0 }
    }
    week.to = day.date
    week.tokens += day.tokens
    if (week.tokens > (busiestWeek?.tokens ?? 0)) busiestWeek = week
  }

  // Current streak: count back from the end, forgiving only today (the
  // last entry) for having no usage yet.
  let end = days.length - 1
  if (end >= 0 && !hasActivity(days[end])) end -= 1
  let length = 0
  let since = ""
  for (let i = end; i >= 0 && hasActivity(days[i]); i--) {
    length += 1
    since = days[i].date
  }

  active.sort((a, b) => a - b)
  const median =
    active.length === 0
      ? null
      : active.length % 2 === 1
        ? active[(active.length - 1) / 2]
        : (active[active.length / 2 - 1] + active[active.length / 2]) / 2

  const top = byWeekday.indexOf(Math.max(...byWeekday))
  return {
    biggest,
    busiestWeek,
    median,
    weekday:
      total > 0 ? { name: WEEKDAYS[top], share: byWeekday[top] / total } : null,
    longest,
    current: length > 0 ? { length, since } : null,
  }
}

/**
 * Heatmap intensity from quartiles of active days — a linear scale would
 * let one huge day flatten everything else to level 1.
 */
export function levelScale(days: SiteDay[]): (tokens: number) => number {
  const active = days
    .map((day) => day.tokens)
    .filter((tokens) => tokens > 0)
    .sort((a, b) => a - b)
  if (active.length === 0) return () => 0
  const at = (p: number) =>
    active[Math.min(active.length - 1, Math.floor(p * active.length))]
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)]
  return (tokens) => {
    if (tokens <= 0) return 0
    if (tokens <= q1) return 1
    if (tokens <= q2) return 2
    if (tokens <= q3) return 3
    return 4
  }
}

/* Labels -------------------------------------------------------------- */

/**
 * Maps, not plain objects: every id below is looked up with a string the
 * collector took from a CLI payload, and nothing constrains those ids
 * beyond "non-empty". On an object literal, `constructor` resolves to a
 * function and `__proto__` to Object.prototype instead of missing — the
 * `?? id` fallback never fires and a row renders the source text of a
 * native function. The producer keeps its own slice maps prototype-free
 * for the same reason (tokens-worker: src/site.ts).
 */
const CLIENT_LABELS = new Map<string, string>([
  ["cursor", "Cursor"],
  ["codex", "Codex"],
  ["claude", "Claude Code"],
  ["pi", "Pi"],
  ["opencode", "OpenCode"],
  ["gemini", "Gemini CLI"],
  ["grok", "Grok Build"],
  ["hermes", "Hermes Agent"],
  ["zed", "Zed"],
  ["unknown", "Other"],
  [OTHER, "Other"],
])

const PROVIDER_LABELS = new Map<string, string>([
  ["anthropic", "Anthropic"],
  ["openai", "OpenAI"],
  ["google", "Google"],
  ["xai", "xAI"],
  ["cursor", "Cursor"],
  ["moonshotai", "Moonshot AI"],
  ["zai", "Z.ai"],
  ["deepseek", "DeepSeek"],
  ["qwen", "Qwen"],
  // Serving gateways: the collector re-attributes their rows to model
  // vendors; these ids remain only for models the rules can't place.
  ["opencode", "OpenCode"],
  ["zed.dev", "Zed"],
  ["unknown", "Other"],
  [OTHER, "Other"],
])

export const clientLabel = (id: string) => CLIENT_LABELS.get(id) ?? id

export const providerLabel = (id: string) => PROVIDER_LABELS.get(id) ?? id

/* Model names ---------------------------------------------------------- */

/**
 * Display names for model ids. The collector reports the CLI's raw model
 * id (claude-opus-4-5); the dashboard should read like a human writes it
 * (Claude Opus 4.5). Exact ids get canonical names from MODEL_NAMES —
 * the room for brand spellings the generic path can't guess (DeepSeek V4
 * Flash, not "Deepseek") — everything else falls back to splitting the id
 * into words, Title Casing them (a couple of acronyms stay uppercase),
 * and joining numeric runs into dotted versions.
 */

/** Words whose display form isn't plain Title Case. */
const MODEL_ACRONYMS = new Map<string, string>([
  ["gpt", "GPT"],
  ["glm", "GLM"],
])

/** Exact-id overrides: canonical names no generic rule could derive.
 *  Add new custom spellings here. */
const MODEL_NAMES = new Map<string, string>([
  ["deepseek-v4-flash", "DeepSeek V4 Flash"],
])

const isVersion = (token: string) => /^\d+(\.\d+)*$/.test(token)

const titleWord = (word: string) =>
  MODEL_ACRONYMS.get(word) ?? word.charAt(0).toUpperCase() + word.slice(1)

/** claude-fable-5 → Claude Fable 5; claude-opus-4-5 → Claude Opus 4.5
 *  (consecutive version parts join with a dot). */
const genericModelName = (id: string) => {
  const words: string[] = []
  for (const raw of id.split(/[-_]/)) {
    const last = words[words.length - 1]
    if (isVersion(raw) && last !== undefined && isVersion(last)) {
      words[words.length - 1] = `${last}.${raw}`
    } else {
      words.push(titleWord(raw))
    }
  }
  return words.join(" ")
}

export const modelLabel = (id: string) =>
  MODEL_NAMES.get(id) ?? genericModelName(id)

/* Brand icons ---------------------------------------------------------- */

/** Placeholder ids the collector reports that aren't real models. */
export const HIDDEN_MODELS = new Set(["unknown", "<synthetic>"])

/** Maps for the same reason the label tables are — and here a stray
 *  inherited value would be interpolated into a CSS attribute selector
 *  (dom.ts, createIcons) rather than merely printed. */
const PROVIDER_ICONS = new Map<string, string>([
  ["anthropic", "anthropic"],
  ["openai", "openai"],
  ["google", "google"],
  ["xai", "xai"],
  ["cursor", "cursor"],
  ["moonshotai", "moonshot"],
  ["zai", "zai"],
  ["deepseek", "deepseek"],
  ["opencode", "opencode"],
  ["zed.dev", "zed"],
])

const CLIENT_ICONS = new Map<string, string>([
  ["cursor", "cursor"],
  ["claude", "claudecode"],
  ["codex", "codex"],
  ["pi", "pi"],
  ["opencode", "opencode"],
  ["gemini", "gemini"],
  ["grok", "grok"],
  ["hermes", "hermesagent"],
  ["zed", "zed"],
])

/** Ordered prefix rules over canonical model names. */
const MODEL_ICONS: [RegExp, string][] = [
  [/^claude/, "claude"],
  [/codex/, "codex"],
  [/^(gpt|o\d)/, "openai"],
  [/^gemini/, "gemini"],
  [/^grok/, "grok"],
  [/^(composer|cursor|auto$|agent)/, "cursor"],
  [/^kimi/, "kimi"],
  [/^deepseek/, "deepseek"],
  [/^glm/, "zai"],
  [/^big-pickle/, "opencode"],
]

/**
 * Lobe Icons slug (vendored under src/assets/icons/ai/) for a breakdown
 * row, or null when the brand has no icon there — rows render a blank
 * spacer so names stay aligned.
 */
export function aiIcon(
  kind: "model" | "client" | "provider",
  id: string,
): string | null {
  if (kind === "provider") return PROVIDER_ICONS.get(id) ?? null
  if (kind === "client") return CLIENT_ICONS.get(id) ?? null
  const model = id.toLowerCase()
  for (const [pattern, icon] of MODEL_ICONS) {
    if (pattern.test(model)) return icon
  }
  return null
}
