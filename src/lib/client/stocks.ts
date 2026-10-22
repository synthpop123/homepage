/**
 * Data layer for the Stocks section: types for cf-workers-api's
 * /stocks/site view (src/services/stocks/compose.ts there), delivered in
 * the /misc bundle, its decoder, and every decision the renderer makes —
 * which ranges exist, where each starts, the returns, the strip's cells,
 * the readout, the rows and every printed figure. Pure and browser-safe.
 *
 * The payload carries returns, never amounts: per account a growth index
 * (time-weighted, so money moving in or out never moves it), holdings by
 * weight, and daily closes of each holding and of the benchmark. Any
 * range's return is two values of a series divided, which is why the
 * ranges are the page's to choose.
 */

import {
  dateFormatter,
  dayInstant,
  isCalendarDay,
  isCount,
  isRecord,
  monthDay,
  swr,
} from "./feed"
import { miscSection } from "./misc"

export type SiteHolding = {
  symbol: string
  weight: number
  /** The position's own return over its life in the account, as the
   *  owner's Ghostfolio computes it (ROI); null when it can't say. */
  performance: number | null
}

/** Cash in one currency, and its share of the account. */
export type SiteCash = { currency: string; weight: number }

export type SiteAccount = {
  id: string
  name: string
  /** The broker's mark; null for the whole portfolio. */
  logo: string | null
  /** Growth index on `days`, 1 at the account's first day, null before. */
  index: (number | null)[]
  holdings: SiteHolding[]
  cash: SiteCash[]
}

export type SiteSymbol = {
  symbol: string
  name: string
  currency: string
  kind: "stock" | "etf" | "other"
  logo: string | null
  closes: (number | null)[]
}

export type Site = {
  schemaVersion: number
  today: string
  /** Market sessions, oldest first: daily for the last year, weekly
   *  before. The last one is the session the latest quotes belong to. */
  days: string[]
  benchmark: { symbol: string; label: string; closes: (number | null)[] }
  accounts: SiteAccount[]
  symbols: SiteSymbol[]
}

/** Lockstep with cf-workers-api's SITE_VERSION in src/services/stocks/compose.ts. */
export const SITE_SCHEMA_VERSION = 2

/* Decoder ---------------------------------------------------------------- */

const isPositive = (value: unknown): value is number =>
  isCount(value) && value > 0

/** A series on the axis: one entry per day, nulls only before it starts. */
const isSeries = (value: unknown, length: number) => {
  if (!Array.isArray(value) || value.length !== length) return false
  let started = false
  for (const entry of value) {
    if (entry === null) {
      if (started) return false
    } else if (isPositive(entry)) started = true
    else return false
  }
  return true
}

const isShare = (value: unknown): value is number =>
  isCount(value) && value <= 1

const isHolding = (value: unknown): value is SiteHolding =>
  isRecord(value) &&
  typeof value.symbol === "string" &&
  isShare(value.weight) &&
  (value.performance === null ||
    (typeof value.performance === "number" &&
      Number.isFinite(value.performance) &&
      value.performance >= -1))

const isCurrency = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value)

const isCash = (value: unknown): value is SiteCash =>
  isRecord(value) && isCurrency(value.currency) && isShare(value.weight)

const isAccount = (value: unknown, length: number): value is SiteAccount =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  (value.logo === null || typeof value.logo === "string") &&
  isSeries(value.index, length) &&
  (value.index as unknown[]).some((entry) => entry !== null) &&
  Array.isArray(value.holdings) &&
  value.holdings.every(isHolding) &&
  Array.isArray(value.cash) &&
  value.cash.every(isCash)

const KINDS = new Set(["stock", "etf", "other"])

const isSymbol = (value: unknown, length: number): value is SiteSymbol =>
  isRecord(value) &&
  typeof value.symbol === "string" &&
  typeof value.name === "string" &&
  isCurrency(value.currency) &&
  typeof value.kind === "string" &&
  KINDS.has(value.kind) &&
  (value.logo === null || typeof value.logo === "string") &&
  isSeries(value.closes, length)

export function isSite(data: unknown): data is Site {
  if (!isRecord(data) || data.schemaVersion !== SITE_SCHEMA_VERSION) {
    return false
  }
  const { days, benchmark, accounts, symbols } = data
  if (
    !isCalendarDay(data.today) ||
    !Array.isArray(days) ||
    days.length < 2 ||
    !days.every(isCalendarDay) ||
    !days.every((day, i) => i === 0 || day > days[i - 1])
  ) {
    return false
  }
  const length = days.length
  return (
    isRecord(benchmark) &&
    typeof benchmark.symbol === "string" &&
    typeof benchmark.label === "string" &&
    isSeries(benchmark.closes, length) &&
    Array.isArray(accounts) &&
    accounts.length > 0 &&
    accounts.every((account) => isAccount(account, length)) &&
    Array.isArray(symbols) &&
    symbols.every((symbol) => isSymbol(symbol, length))
  )
}

export const loadSite = (
  endpoint: string,
  onData: (site: Site) => void,
): Promise<void> =>
  swr(
    `stocks:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => miscSection(endpoint, "stocks") as Promise<Site>,
    isSite,
    onData,
  )

/* Ranges ----------------------------------------------------------------- */

export const RANGES = ["1W", "1M", "3M", "YTD", "1Y", "ALL"] as const
export type Range = (typeof RANGES)[number]

export const DEFAULT_RANGE: Range = "3M"

const shiftMonths = (day: string, months: number) => {
  const [y, m, d] = day.split("-").map(Number)
  // Clamp to the target month's last day: a month before Mar 31 is Feb 28.
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last)))
    .toISOString()
    .slice(0, 10)
}

/** The day a range is measured from: its return is the close of the last
 *  day against the close on (or the last session before) this one. */
export function rangeCutoff(range: Range, last: string): string | null {
  switch (range) {
    case "1W": {
      const date = dayInstant(last)
      date.setUTCDate(date.getUTCDate() - 7)
      return date.toISOString().slice(0, 10)
    }
    case "1M":
      return shiftMonths(last, -1)
    case "3M":
      return shiftMonths(last, -3)
    case "YTD":
      return `${Number(last.slice(0, 4)) - 1}-12-31`
    case "1Y":
      return shiftMonths(last, -12)
    case "ALL":
      return null
  }
}

/** The first index a series has a value at. */
export const firstValue = (series: (number | null)[]) =>
  series.findIndex((value) => value !== null)

/**
 * Where a range starts on the axis for a series: the last day on or
 * before its cutoff, or the series' own start when it began later.
 */
export function rangeStart(
  days: string[],
  range: Range,
  series: (number | null)[],
): number {
  const begin = Math.max(0, firstValue(series))
  const cutoff = rangeCutoff(range, days[days.length - 1])
  if (cutoff === null) return begin
  let at = -1
  for (let i = 0; i < days.length && days[i] <= cutoff; i++) at = i
  return Math.max(at, begin)
}

/**
 * The ranges worth a tab for a series: each one that starts later than
 * the series does (a range reaching past its start would just repeat
 * ALL), and ALL.
 */
export function availableRanges(
  days: string[],
  series: (number | null)[],
): Range[] {
  const begin = Math.max(0, firstValue(series))
  return RANGES.filter((range) => {
    if (range === "ALL") return true
    const cutoff = rangeCutoff(range, days[days.length - 1])
    return (
      cutoff !== null &&
      days[begin] < cutoff &&
      days.at(-1) !== days[rangeStart(days, range, series)]
    )
  })
}

export function rangeLabel(range: Range, days: string[], start: number) {
  switch (range) {
    case "1W":
      return "Past week"
    case "1M":
      return "Past month"
    case "3M":
      return "Past 3 months"
    case "YTD":
      return "Year to date"
    case "1Y":
      return "Past year"
    case "ALL":
      return `Since ${monthYear.format(dayInstant(days[start]))}`
  }
}

/* Returns ---------------------------------------------------------------- */

/** The series' change from `start` to `end`, or null without a value at
 *  the start. */
export function change(
  series: (number | null)[],
  start: number,
  end = series.length - 1,
): number | null {
  const from = series[start]
  const to = series[end]
  return from === null || to === null ? null : to / from - 1
}

/** The deepest fall from a running peak inside [start, end], with the
 *  days it ran between; null when the series never fell. */
export function maxDrawdown(
  series: (number | null)[],
  start: number,
  end = series.length - 1,
): { depth: number; peak: number; trough: number } | null {
  let peak = start
  let worst: { depth: number; peak: number; trough: number } | null = null
  for (let i = start; i <= end; i++) {
    const value = series[i]
    const top = series[peak]
    if (value === null || top === null) continue
    if (value > top) peak = i
    const depth = value / (series[peak] as number) - 1
    if (depth < 0 && (!worst || depth < worst.depth)) {
      worst = { depth, peak, trough: i }
    }
  }
  return worst
}

/* The strip: one cell per day, week or month of the range --------------- */

export type Grain = "day" | "week" | "month"

/** Days in a range, and so how coarse a cell has to be to fit a row. */
export const grainFor = (sessions: number): Grain =>
  sessions <= 70 ? "day" : sessions <= 300 ? "week" : "month"

const weekKey = (day: string) => {
  const date = dayInstant(day)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

export type StripCell = {
  /** First and last axis index the cell covers. */
  from: number
  to: number
  change: number
  /** 0 flat, 1–4 by size against the range's typical move. */
  level: number
  title: string
}

/**
 * Cut the range into cells of `grain`, each holding its own change (from
 * the previous cell's last close to its own), and grade each by its size
 * against the root mean square of them all, so a calm range and a wild
 * one both use the whole scale.
 */
export function stripCells(
  days: string[],
  series: (number | null)[],
  start: number,
  grain: Grain,
): StripCell[] {
  const key = (day: string) =>
    grain === "day" ? day : grain === "week" ? weekKey(day) : day.slice(0, 7)
  const cells: Omit<StripCell, "level" | "title">[] = []
  let base = start
  for (let i = start + 1; i < days.length; i++) {
    const last = cells[cells.length - 1]
    if (last && key(days[last.to]) === key(days[i])) {
      last.to = i
      last.change = (change(series, base, i) ?? 0) as number
    } else {
      if (last) base = last.to
      cells.push({ from: i, to: i, change: change(series, base, i) ?? 0 })
    }
  }
  const rms =
    Math.sqrt(
      cells.reduce((sum, cell) => sum + cell.change ** 2, 0) /
        Math.max(1, cells.length),
    ) || 1
  return cells.map((cell) => {
    const size = Math.abs(cell.change) / rms
    const level =
      Math.abs(cell.change) < 5e-5
        ? 0
        : size < 0.35
          ? 1
          : size < 0.8
            ? 2
            : size < 1.5
              ? 3
              : 4
    return {
      ...cell,
      level,
      title: `${cellLabel(days, cell, grain)} ${formatReturn(cell.change)}`,
    }
  })
}

const cellLabel = (
  days: string[],
  cell: { from: number; to: number },
  grain: Grain,
) =>
  grain === "day"
    ? monthDay.format(dayInstant(days[cell.to]))
    : grain === "week"
      ? `Week of ${monthDay.format(dayInstant(weekKey(days[cell.from])))}`
      : monthYear.format(dayInstant(days[cell.to]))

/* Figures ---------------------------------------------------------------- */

const MINUS = "−"

const monthYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

/** `+12.73%`, `−3.10%`, `0.00%`: a true minus, and no sign on nothing. */
export function formatReturn(value: number, digits = 2): string {
  const text = (Math.abs(value) * 100).toFixed(digits)
  if (Number(text) === 0) return `${(0).toFixed(digits)}%`
  return `${value < 0 ? MINUS : "+"}${text}%`
}

/** Percentage points between two returns: `+3.2 pp`. */
export function formatPoints(value: number): string {
  const text = (Math.abs(value) * 100).toFixed(1)
  if (Number(text) === 0) return "0.0 pp"
  return `${value < 0 ? MINUS : "+"}${text} pp`
}

export const formatWeight = (weight: number) => `${(weight * 100).toFixed(1)}%`

const priceFormatters = new Map<string, Intl.NumberFormat>()

/** `$532.95`, `HK$668.50`: the currency's own sign, two decimals. */
export function formatPrice(value: number, currency: string): string {
  let formatter = priceFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    priceFormatters.set(currency, formatter)
  }
  return formatter.format(value)
}

/** A price move with its sign: `+$12.30`, `−$4.05`. */
export const formatPriceChange = (value: number, currency: string) =>
  `${value < 0 ? MINUS : "+"}${formatPrice(Math.abs(value), currency)}`

export const formatDay = (day: string) => dateFormatter.format(dayInstant(day))

export const direction = (value: number | null) =>
  value === null
    ? "flat"
    : value > 5e-5
      ? "up"
      : value < -5e-5
        ? "down"
        : "flat"

/* The section's state, resolved ---------------------------------------- */

export type ReadoutCard = { label: string; value: string; note: string }

export type Row = {
  symbol: string
  name: string
  currency: string
  logo: string | null
  weight: number
  /** The position's own return since it was bought, not the range's. */
  performance: number | null
  /** Where in the range its price line starts (a listing inside it). */
  start: number
}

export type View = {
  account: SiteAccount
  range: Range
  ranges: Range[]
  start: number
  label: string
  change: number
  benchmark: number | null
  cards: ReadoutCard[]
  rows: Row[]
  cash: SiteCash[]
}

/** Everything the section draws for one account and range. */
export function view(site: Site, accountId: string, wanted: Range): View {
  const account =
    site.accounts.find((entry) => entry.id === accountId) ?? site.accounts[0]
  const ranges = availableRanges(site.days, account.index)
  const range = ranges.includes(wanted)
    ? wanted
    : ranges.includes(DEFAULT_RANGE)
      ? DEFAULT_RANGE
      : "ALL"
  const start = rangeStart(site.days, range, account.index)
  const end = site.days.length - 1
  const label = rangeLabel(range, site.days, start)
  const total = change(account.index, start) ?? 0
  const bench = change(site.benchmark.closes, start)
  const session = change(account.index, Math.max(start, end - 1))
  const drawdown = maxDrawdown(account.index, start)

  const cards: ReadoutCard[] = [
    { label: "Return", value: formatReturn(total), note: label },
    {
      label: "Last session",
      value: formatReturn(end > 0 ? (session ?? 0) : 0),
      note: monthDay.format(dayInstant(site.days[end])),
    },
    {
      label: `vs ${site.benchmark.label}`,
      value: bench === null ? "—" : formatPoints(total - bench),
      note:
        bench === null
          ? `No ${site.benchmark.label} closes`
          : `${site.benchmark.label} ${formatReturn(bench, 1)}`,
    },
    drawdown
      ? {
          label: "Max drawdown",
          value: formatReturn(drawdown.depth, 1),
          note: `${monthDay.format(dayInstant(site.days[drawdown.peak]))} → ${monthDay.format(dayInstant(site.days[drawdown.trough]))}`,
        }
      : { label: "Max drawdown", value: "None", note: "Never below a peak" },
  ]

  const symbols = new Map(site.symbols.map((entry) => [entry.symbol, entry]))
  const rows = account.holdings.flatMap((holding): Row[] => {
    const entry = symbols.get(holding.symbol)
    if (!entry) return []
    const from = Math.max(start, firstValue(entry.closes))
    return [
      {
        symbol: entry.symbol,
        name: entry.name,
        currency: entry.currency,
        logo: entry.logo,
        weight: holding.weight,
        performance: holding.performance,
        start: from,
      },
    ]
  })

  return {
    account,
    range,
    ranges,
    start,
    label,
    change: total,
    benchmark: bench,
    cards,
    rows,
    cash: account.cash,
  }
}

/** The line under the hero figure, at rest or while scrubbing to `at`. */
export function heroNote(
  site: Site,
  start: number,
  label: string,
  at: number | null,
): string {
  const end = at ?? site.days.length - 1
  const bench = change(site.benchmark.closes, start, end)
  const when =
    at === null
      ? label
      : `${formatDay(site.days[start])} → ${formatDay(site.days[end])}`
  return bench === null
    ? when
    : `${when} · ${site.benchmark.label} ${formatReturn(bench)}`
}

/** A holding's price line over a range, for the expanded row. */
export function priceView(
  site: Site,
  symbol: string,
  wanted: Range,
): {
  entry: SiteSymbol
  range: Range
  ranges: Range[]
  start: number
  label: string
} | null {
  const entry = site.symbols.find((item) => item.symbol === symbol)
  if (!entry) return null
  const ranges = availableRanges(site.days, entry.closes)
  const range = ranges.includes(wanted) ? wanted : "ALL"
  const start = rangeStart(site.days, range, entry.closes)
  return {
    entry,
    range,
    ranges,
    start,
    label: rangeLabel(range, site.days, start),
  }
}
