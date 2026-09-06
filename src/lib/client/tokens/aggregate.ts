/**
 * Everything the dashboard derives from the payload before a renderer
 * touches the DOM: the dense daily series, trend-chart stacks and
 * buckets, window totals and deltas, the Today view, weekday profile,
 * fact cards and heatmap scale. Pure functions over `Site`, so all of
 * it is covered by aggregate.test.ts without a browser.
 */
import { weekdayIndex } from "../heatmap"
import {
  shiftDays,
  formatDay,
  formatDate,
  formatMonth,
  formatMonthTitle,
  WEEKDAYS,
} from "./format"
import {
  OTHER,
  PLACEHOLDER_IDS,
  clientLabel,
  providerLabel,
  modelLabel,
} from "./labels"
import {
  type Site,
  type SiteDay,
  type SiteRange,
  type Usage,
  type MetricKey,
  type ModelCell,
} from "./schema"

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
        models: {},
      },
    )
  }
  return days
}

/** The three dimensions the daily series is sliced by. */
export type StackDim = "provider" | "client" | "model"

/** A trend-chart stacking: dimension plus the ids that get own colors. */
export type Stack = { dim: StackDim; ids: string[] }

/**
 * How many ids keep their own color, in every dimension. Three plus the
 * residual is what the legend fits on one line under the chart, and the
 * top three carry almost everything in all three id spaces; a wider
 * model stack bought a little more of the handover story and cost a
 * legend that wrapped to three rows.
 */
const STACK_LIMIT = 3

const rangeRows = (
  range: SiteRange,
  dim: StackDim,
): { id: string; usage: Usage }[] =>
  dim === "provider"
    ? range.byProvider.map((entry) => ({ id: entry.provider, usage: entry }))
    : dim === "client"
      ? range.byClient.map((entry) => ({ id: entry.client, usage: entry }))
      : range.byModel.map((entry) => ({ id: entry.model, usage: entry }))

/**
 * The ids worth their own color when stacking the trend chart by `dim`:
 * the top few *within the range being charted, by the metric being
 * drawn*, so the colored segments are whoever actually drove that
 * window — all-time ranks would fold a currently-busy provider into
 * "other" to keep a slot for one that has gone quiet, and token ranks
 * would do the same to a model that is a small share of the volume but
 * a large share of the bill. Everything below the cutoff collapses into
 * "other", placeholder ids (`unknown`, `<synthetic>`) included: they are
 * the one thing a color band can't say anything about.
 */
export function stackFor(
  range: SiteRange,
  dim: StackDim,
  metric: MetricKey,
): Stack {
  const named = rangeRows(range, dim)
    .filter(({ id }) => id && !PLACEHOLDER_IDS.has(id))
    .sort((a, b) => b.usage[metric] - a.usage[metric])
    .slice(0, STACK_LIMIT)
    .map(({ id }) => id)
  return { dim, ids: [...named, OTHER] }
}

export const stackLabel = (dim: StackDim, id: string) =>
  dim === "provider"
    ? providerLabel(id)
    : dim === "client"
      ? clientLabel(id)
      : id === OTHER
        ? "Other"
        : modelLabel(id)

/** Where a stack segment takes its color from: a brand hue plus, for the
 *  model dimension, how far to mix it toward the background. */
export type StackPaint = { p: string; shade: number }

/** Shades 0…3; past that the tints stop being tellable apart. */
const SHADE_STEPS = 4

/**
 * Which vendor each model of a range belongs to, as the collector
 * reported it — the payload already resolved gateways and aliases to
 * canonical vendors, so nothing here guesses from a model's name. Only
 * an unambiguous attribution earns a hue: a model served by two vendors
 * (or only by a placeholder) stays neutral rather than picking one.
 */
export const modelVendors = (range: SiteRange): Map<string, string> =>
  new Map(
    range.byModel.flatMap(({ model, providers }) =>
      providers.length === 1 && !PLACEHOLDER_IDS.has(providers[0])
        ? [[model, providers[0]] as [string, string]]
        : [],
    ),
  )

/**
 * Colors for a stack's ids, aligned with `stack.ids`.
 *
 * Provider and client ids are their own palette keys — a closed set of
 * brand hues, one CSS rule each. Model ids are 40-odd and growing, so
 * they take their *vendor's* hue instead (Opus renders Anthropic coral
 * because it is Anthropic, matching what provider stacking shows) and
 * separate within it by shade, assigned in stack order so a vendor's
 * busiest model is its most saturated band. Nothing to maintain when a
 * new model appears: it inherits the vendor reported by the collector.
 */
export function stackPaint(
  stack: Stack,
  vendors: ReadonlyMap<string, string>,
): StackPaint[] {
  // The residual segment is the plain grey; unbranded models start one
  // shade in so they never render as a second "other".
  const used = new Map<string, number>([[OTHER, 1]])
  return stack.ids.map((id) => {
    if (stack.dim !== "model" || id === OTHER) return { p: id, shade: 0 }
    const brand = vendors.get(id) ?? OTHER
    const seen = used.get(brand) ?? 0
    used.set(brand, seen + 1)
    return { p: brand, shade: Math.min(seen, SHADE_STEPS - 1) }
  })
}

const daySlices = (day: SiteDay, dim: StackDim) =>
  dim === "provider"
    ? day.providers
    : dim === "client"
      ? day.clients
      : day.models

export type Bucket = {
  label: string
  title: string
  tokens: number
  cost: number
  messages: number
  /** CLI-reported active time (ms) over the bucket's days. */
  active: number
  /** The metric summed over *only* the days that reported active time,
   *  so the per-hour ratio divides two numbers about the same days. */
  activeMetric: number
  /** Aligned with the id order of the stack passed to the bucket builders. */
  segments: number[]
}

const emptyBucket = (label: string, title: string, stack: Stack): Bucket => ({
  label,
  title,
  tokens: 0,
  cost: 0,
  messages: 0,
  active: 0,
  activeMetric: 0,
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
  if (day.active && day.active > 0) {
    bucket.active += day.active
    bucket.activeMetric += day[metric]
  }
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

/**
 * Total CLI-reported active time (ms), how many days carried it, and the
 * usage on those days — the intensity ratio ("tokens per hour of actual
 * work") has to divide by the same days it measures, and the CLI only
 * began tracking time partway through the history.
 */
export function activeTotals(daily: SiteDay[]) {
  let ms = 0
  let days = 0
  let tokens = 0
  let cost = 0
  for (const day of daily) {
    if (day.active && day.active > 0) {
      ms += day.active
      days += 1
      tokens += day.tokens
      cost += day.cost
    }
  }
  return { ms, days, tokens, cost }
}

/** Consumption per hour of tracked active time; 0 without a duration. */
export const perHour = (value: number, ms: number) =>
  ms > 0 ? value / (ms / 3_600_000) : 0

/**
 * When a machine last reported, i.e. how fresh the numbers actually are.
 * `generatedAt` answers a different question — the collector recomposes
 * the payload on every accepted submission, including the ones that
 * change nothing, so it reads "just now" through an idle afternoon.
 */
export const lastReport = (site: Site): number | null => {
  let latest: number | null = null
  for (const device of site.devices) {
    if (
      device.lastSeen !== null &&
      (latest === null || device.lastSeen > latest)
    )
      latest = device.lastSeen
  }
  return latest
}

/* Today --------------------------------------------------------------- */

/** Clients that keep their own bar segment; the tail merges. The legend
 *  is not capped — see TodayView.clients. */
const MIX_SEGMENTS = 4
const TOP_MODELS = 5

/** A slice of the day's tokens: one client, or the merged tail. */
export type TodaySlice = {
  id: string
  label: string
  tokens: number
  share: number
}

/** A client of the day, plus the models it drove today. */
export type TodayClient = TodaySlice & { models: ModelCell[] }

export type TodayView = {
  /** Nothing recorded yet — the section collapses to a single line
   *  rather than showing a wall of zeroes. */
  idle: boolean
  totals: SiteRange["totals"]
  /** CLI-reported active time today (ms), 0 where none was reported. */
  active: number
  /** Yesterday, the baseline every delta is measured against. */
  before: ReturnType<typeof windowTotals> & { active: number }
  /** The bar's segments: the day's top clients, with everything below
   *  the cutoff merged into one residual slice so the bar still sums to
   *  the day. A cap belongs to the bar alone — past a few slices the
   *  segments stop being tellable apart — which is why the legend reads
   *  `clients` instead. */
  mix: TodaySlice[]
  /** Every client of the day, in rank order, each with the models
   *  behind it. Empty when the day has no tokens to apportion (a
   *  message- or active-time-only day is not idle, but it has no
   *  breakdown either). */
  clients: TodayClient[]
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

  const slice = (id: string, tokens: number): TodaySlice => ({
    id,
    label: clientLabel(id),
    tokens,
    share: tokens / totals.tokens,
  })

  const rows = byClient.filter(
    (row) => row.tokens > 0 && !PLACEHOLDER_IDS.has(row.client),
  )
  const clients =
    totals.tokens > 0
      ? rows.map((row) => ({
          ...slice(row.client, row.tokens),
          models: row.models,
        }))
      : []
  // Only the *bar* merges its tail, and only because a 1%-wide segment
  // is not a segment. Every client still gets its own legend row: the
  // row is where the name, the models behind it and the exact share
  // are, and folding a named client into an iconless "Other" there read
  // as usage the collector could not attribute.
  const tail = rows
    .slice(MIX_SEGMENTS)
    .reduce((sum, row) => sum + row.tokens, 0)
  const mix =
    clients.length === 0
      ? []
      : [
          ...clients
            .slice(0, MIX_SEGMENTS)
            .map((row) => slice(row.id, row.tokens)),
          ...(tail > 0 ? [slice(OTHER, tail)] : []),
        ]

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
    clients,
    models: byModel
      .filter((row) => row.tokens > 0 && !PLACEHOLDER_IDS.has(row.model))
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
