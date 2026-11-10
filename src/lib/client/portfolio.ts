/**
 * Data layer for the Portfolio section: types for cf-workers-api's
 * /portfolio/site view (src/services/portfolio/compose.ts there), delivered in
 * the /misc bundle, its decoder, and every decision the renderer makes —
 * which ranges exist, where each starts, the returns, the strip's cells,
 * the readout, the rows and every printed figure. Pure and browser-safe.
 *
 * The payload carries returns, never amounts: per account its value and
 * the money put into it as ratios on one scale, holdings by weight with
 * the average price paid per share, and daily closes of each holding and
 * of the benchmark. A range's return is what the money did — its gain
 * over the value it started from plus what was put in since — so a
 * deposit never reads as a gain, and any range is the page's to choose.
 */

import {
  dateFormatter,
  dayInstant,
  isCalendarDay,
  isCount,
  isRecord,
  monthDay,
  safeHttpUrl,
  swr,
} from "./feed"
import { miscSection } from "./misc"
import { inset, type Rect, squarify } from "./treemap"

export type SiteHolding = {
  symbol: string
  weight: number
  /** The position's own return over its life in the account: gain
   *  (realised, unrealised and income) over what went into it; null when
   *  the ledger can't say. */
  performance: number | null
  /** Average price paid per share in this account, in the symbol's
   *  currency; null when the ledger can't say. */
  cost: number | null
  /** The first buy in this account. */
  since: string | null
}

/** One market day's return. */
export type SiteMove = { date: string; change: number }

/** Cash in one currency, and its share of the account. */
export type SiteCash = { currency: string; weight: number }

/** The deepest fall from a running peak, from `from` to the latest
 *  session, read daily by the worker; `depth` 0 when it never fell. */
export type SiteFall = {
  from: string
  depth: number
  peak: string
  trough: string
}

export type SiteAccount = {
  id: string
  name: string
  /** The broker's mark; null for the whole portfolio. */
  logo: string | null
  /** Value (holdings and cash) on `days` over the most ever put in; null
   *  before the account starts. */
  value: (number | null)[]
  /** Money put in to date, net, on the same scale and days. */
  invested: (number | null)[]
  /** The worker's daily returns chained, on `days`: 1 at the start, null
   *  before. Its rules (no return on dust) ride along, which the two
   *  ratios above cannot carry. */
  growth: (number | null)[]
  /** The deepest fall from each day the weekly part of the axis keeps,
   *  read daily — that part hides a week's peak and trough. */
  falls: SiteFall[]
  /** The best days on record, newest first, each beating every day
   *  after it, read daily (`bestDay` cuts it to a range). */
  best: SiteMove[]
  holdings: SiteHolding[]
  cash: SiteCash[]
}

export type SiteSymbol = {
  symbol: string
  name: string
  currency: string
  kind: "stock" | "etf" | "other"
  logo: string | null
  /** A stock's sector; null for a fund. */
  sector: string | null
  /** ISO 3166 alpha-2. */
  country: string | null
  /** The company's site (check with `safeHttpUrl` before linking). */
  url: string | null
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

/** Lockstep with cf-workers-api's SITE_VERSION in src/services/portfolio/compose.ts. */
export const SITE_SCHEMA_VERSION = 7

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

/** An account's two series: nulls, then numbers from the same day on —
 *  a value never below nothing, money in of either sign. */
const isCapital = (value: unknown, invested: unknown, length: number) => {
  if (
    !Array.isArray(value) ||
    !Array.isArray(invested) ||
    value.length !== length ||
    invested.length !== length
  ) {
    return false
  }
  const start = value.findIndex((entry) => entry !== null)
  return (
    start >= 0 &&
    value.every((entry, i) =>
      i < start ? entry === null && invested[i] === null : isCount(entry),
    ) &&
    invested
      .slice(start)
      .every((entry) => typeof entry === "number" && Number.isFinite(entry))
  )
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
      value.performance >= -1)) &&
  (value.cost === null || isPositive(value.cost)) &&
  (value.since === null || isCalendarDay(value.since))

const isCurrency = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value)

const isCash = (value: unknown): value is SiteCash =>
  isRecord(value) && isCurrency(value.currency) && isShare(value.weight)

const isMove = (value: unknown): value is SiteMove =>
  isRecord(value) &&
  isCalendarDay(value.date) &&
  typeof value.change === "number" &&
  Number.isFinite(value.change) &&
  value.change >= -1

const isFall = (value: unknown): value is SiteFall =>
  isRecord(value) &&
  isCalendarDay(value.from) &&
  typeof value.depth === "number" &&
  Number.isFinite(value.depth) &&
  value.depth <= 0 &&
  value.depth >= -1 &&
  isCalendarDay(value.peak) &&
  isCalendarDay(value.trough)

/** The growth index starts the day the value does. */
const isGrowth = (value: unknown, series: unknown, length: number) =>
  isSeries(value, length) &&
  Array.isArray(series) &&
  (value as unknown[]).findIndex((entry) => entry !== null) ===
    series.findIndex((entry) => entry !== null)

const isAccount = (value: unknown, length: number): value is SiteAccount =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  (value.logo === null || typeof value.logo === "string") &&
  isCapital(value.value, value.invested, length) &&
  isGrowth(value.growth, value.value, length) &&
  Array.isArray(value.falls) &&
  value.falls.every(isFall) &&
  Array.isArray(value.best) &&
  value.best.every(isMove) &&
  Array.isArray(value.holdings) &&
  value.holdings.every(isHolding) &&
  Array.isArray(value.cash) &&
  value.cash.every(isCash)

const KINDS = new Set(["stock", "etf", "other"])

const isText = (value: unknown) => value === null || typeof value === "string"

const isSymbol = (value: unknown, length: number): value is SiteSymbol =>
  isRecord(value) &&
  typeof value.symbol === "string" &&
  typeof value.name === "string" &&
  isCurrency(value.currency) &&
  typeof value.kind === "string" &&
  KINDS.has(value.kind) &&
  (value.logo === null || typeof value.logo === "string") &&
  isText(value.sector) &&
  (value.country === null ||
    (typeof value.country === "string" && /^[A-Z]{2}$/.test(value.country))) &&
  isText(value.url) &&
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
    `portfolio:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => miscSection(endpoint, "portfolio") as Promise<Site>,
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

type Capital = Pick<SiteAccount, "value" | "invested">

/**
 * Each day's return on the money at work, chained: the gain over the
 * previous close plus that day's money in (money taken out is added back
 * to the close). 1 on the account's first day, null before. Money moving
 * never moves it; over one session it is `moneyReturns` over that
 * session. Only for a payload without the worker's own (`/now`'s tile):
 * /misc reads `SiteAccount.growth`, which also applies the worker's rule
 * that a day starting from dust earns nothing.
 */
export function growth({ value, invested }: Capital): (number | null)[] {
  let level: number | null = null
  return value.map((close, i) => {
    const before = value[i - 1]
    if (close === null) return null
    if (level === null || before === null || before === undefined) {
      level = 1
      return level
    }
    const flow = (invested[i] as number) - (invested[i - 1] as number)
    const base = before + Math.max(0, flow)
    if (base > 0) level *= (close + Math.max(0, -flow)) / base
    return level
  })
}

/**
 * What the money did from `start` to each day after it: the gain since
 * `start` over what was at work — the value it started from plus every
 * sum put in since. A deposit adds to both, so it never reads as a gain;
 * money taken out leaves what it earned behind. 0 at `start`.
 *
 * With a benchmark's closes, the same for the same money in it: the value
 * at `start` and every sum after it buying the benchmark on its day (and
 * money taken out selling it), measured the same way. Null without a
 * close at `start`.
 */
export function moneyReturns(account: Capital, start: number): number[]
export function moneyReturns(
  account: Capital,
  start: number,
  closes: (number | null)[],
): number[] | null
export function moneyReturns(
  { value, invested }: Capital,
  start: number,
  closes?: (number | null)[],
): number[] | null {
  const v0 = value[start] as number
  const n0 = invested[start] as number
  const p0 = closes?.[start]
  if (closes && (p0 === null || p0 === undefined)) return null
  let units = closes ? v0 / (p0 as number) : 0
  let price = p0 ?? 0
  let added = 0
  const out = [0]
  for (let i = start + 1; i < value.length; i++) {
    const flow = (invested[i] as number) - (invested[i - 1] as number)
    added += Math.max(0, flow)
    if (closes) {
      price = closes[i] ?? price
      units += flow / price
    }
    const now = closes ? units * price : (value[i] as number)
    const base = v0 + added
    out.push(base > 0 ? (now - v0 - ((invested[i] as number) - n0)) / base : 0)
  }
  return out
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

/** A range's deepest fall, with the days it ran between: the worker's
 *  daily reading where the range starts on the weekly part of the axis
 *  (a week's peak and trough are not on it), else measured off the
 *  daily axis. Null when it never fell. */
export function rangeDrawdown(
  site: Pick<Site, "days">,
  account: Pick<SiteAccount, "growth" | "falls">,
  start: number,
): { depth: number; peak: string; trough: string } | null {
  const from = site.days[start]
  const fall = account.falls.find((entry) => entry.from === from)
  if (fall) return fall.depth < 0 ? fall : null
  const measured = maxDrawdown(account.growth, start)
  return (
    measured && {
      depth: measured.depth,
      peak: site.days[measured.peak],
      trough: site.days[measured.trough],
    }
  )
}

/** The best day after `from` (a range's start, exclusive): the earliest
 *  of the worker's records dated after it. */
export const bestDay = (best: SiteMove[], from: string): SiteMove | null =>
  best.findLast((move) => move.date > from) ?? null

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
  /** The latest close, and the average price paid for a share. */
  price: number | null
  cost: number | null
  since: string | null
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
  /** The range's return at each of its days, as levels from 1 (what the
   *  chart draws), and the same money in the benchmark, likewise. */
  line: number[]
  ghost: number[] | null
  /** The account's chained daily returns over the whole axis. */
  growth: (number | null)[]
  cards: ReadoutCard[]
  rows: Row[]
  cash: SiteCash[]
}

/** Everything the section draws for one account and range. */
export function view(site: Site, accountId: string, wanted: Range): View {
  const account =
    site.accounts.find((entry) => entry.id === accountId) ?? site.accounts[0]
  const ranges = availableRanges(site.days, account.value)
  const range = ranges.includes(wanted)
    ? wanted
    : ranges.includes(DEFAULT_RANGE)
      ? DEFAULT_RANGE
      : "ALL"
  const start = rangeStart(site.days, range, account.value)
  const end = site.days.length - 1
  const label = rangeLabel(range, site.days, start)
  const returns = moneyReturns(account, start)
  const same = moneyReturns(account, start, site.benchmark.closes)
  const total = returns[returns.length - 1]
  const bench = same ? same[same.length - 1] : null
  const daily = account.growth
  const session = change(daily, Math.max(start, end - 1))
  const drawdown = rangeDrawdown(site, account, start)
  const best = bestDay(account.best, site.days[start])

  // The range's return is the hero figure; the cells say what it hides.
  const cards: ReadoutCard[] = [
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
          : `${site.benchmark.label} ${formatReturn(bench)}`,
    },
    drawdown
      ? {
          label: "Max drawdown",
          value: formatReturn(drawdown.depth, 1),
          note: `${monthDay.format(dayInstant(drawdown.peak))} → ${monthDay.format(dayInstant(drawdown.trough))}`,
        }
      : { label: "Max drawdown", value: "None", note: "Never below a peak" },
    best && best.change > 0
      ? {
          label: "Best day",
          value: formatReturn(best.change),
          note: monthDay.format(dayInstant(best.date)),
        }
      : { label: "Best day", value: "None", note: "No day up" },
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
        price: entry.closes[entry.closes.length - 1],
        cost: holding.cost,
        since: holding.since,
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
    line: returns.map((value) => 1 + value),
    ghost: same ? same.map((value) => 1 + value) : null,
    growth: daily,
    cards,
    rows,
    cash: account.cash,
  }
}

/** The line under the hero figure: the range at rest, its two days
 *  while scrubbing to `at`. The benchmark is the readout's. */
export function heroNote(
  site: Site,
  start: number,
  label: string,
  at: number | null,
): string {
  return at === null
    ? label
    : `${formatDay(site.days[start])} → ${formatDay(site.days[at])}`
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

/* An opened row's facts ------------------------------------------------ */

const regionNames = new Intl.DisplayNames(["en"], { type: "region" })

/** How long since a day, from the last session: `12 days`, `9 mo`, `1.4 yr`. */
export function heldFor(since: string, last: string): string {
  const days = Math.max(1, daysApart(since, last))
  if (days < 31) return `${days} day${days === 1 ? "" : "s"}`
  const months = Math.round(days / 30.44)
  return months < 12 ? `${months} mo` : `${(months / 12).toFixed(1)} yr`
}

const daysApart = (from: string, to: string) =>
  Math.round((dayInstant(to).getTime() - dayInstant(from).getTime()) / 864e5)

export type PriceBand = {
  label: string
  low: number
  high: number
  /** 0–1 along the band: the band reaches the cost when it lies outside
   *  the year's prices, so both marks always fit. */
  price: number
  cost: number | null
}

export type Facts = {
  /** Sector and country, in that order, whichever are known. */
  about: string[]
  /** The company's site host, without `www.`, and its URL. */
  site: { host: string; href: string } | null
  cards: ReadoutCard[]
  band: PriceBand | null
  /** Where the first buy falls on the axis, if it does. */
  bought: number | null
}

/** Everything an opened row says beside its price line. */
export function holdingFacts(
  site: Site,
  row: Pick<Row, "symbol" | "price" | "cost" | "since">,
): Facts | null {
  const entry = site.symbols.find((item) => item.symbol === row.symbol)
  if (!entry) return null
  const end = site.days.length - 1
  const last = site.days[end]

  const about: string[] = []
  if (entry.kind === "etf") about.push("ETF")
  else if (entry.sector) about.push(entry.sector)
  if (entry.country) {
    try {
      about.push(regionNames.of(entry.country) ?? entry.country)
    } catch {
      about.push(entry.country)
    }
  }

  const { price, cost } = row
  const session = change(entry.closes, Math.max(0, end - 1))
  const cards: ReadoutCard[] = [
    {
      label: "Avg cost",
      value: cost === null ? "—" : formatPrice(cost, entry.currency),
      note: "per share",
    },
    {
      label: "vs cost",
      value:
        cost === null || price === null
          ? "—"
          : formatReturn(price / cost - 1, 1),
      note:
        cost === null || price === null
          ? "No cost recorded"
          : `${formatPriceChange(price - cost, entry.currency)} a share`,
    },
    {
      label: "Last session",
      value: formatReturn(session ?? 0),
      note: monthDay.format(dayInstant(last)),
    },
    row.since
      ? {
          label: "Held",
          value: heldFor(row.since, last),
          note: `since ${monthYear.format(dayInstant(row.since))}`,
        }
      : { label: "Held", value: "—", note: "" },
  ]

  const yearStart = rangeStart(site.days, "1Y", entry.closes)
  const year = entry.closes
    .slice(yearStart)
    .filter((value): value is number => value !== null)
  let band: PriceBand | null = null
  if (year.length > 1 && price !== null) {
    const low = Math.min(...year)
    const high = Math.max(...year)
    const from = Math.min(low, cost ?? low)
    const to = Math.max(high, cost ?? high)
    const at = (value: number) =>
      to > from ? (value - from) / (to - from) : 0.5
    const cutoff = rangeCutoff("1Y", last) as string
    band = {
      label:
        site.days[yearStart] > cutoff
          ? `Range since ${monthYear.format(dayInstant(site.days[yearStart]))}`
          : "52-week range",
      low,
      high,
      price: at(price),
      cost: cost === null ? null : at(cost),
    }
  }

  const bought = row.since
    ? site.days.findIndex((day) => day >= (row.since as string))
    : -1
  const href = safeHttpUrl(entry.url)
  return {
    about,
    site: href
      ? { host: new URL(href).hostname.replace(/^www\./, ""), href }
      : null,
    cards,
    band,
    bought: bought >= 0 ? bought : null,
  }
}

/* Allocation ------------------------------------------------------------ */

/**
 * The holdings as a treemap: area by weight, each tile graded by the last
 * session's move or by the position's own return, gains in the heatmap's
 * greens and losses in ink. Cash and the funds the owner counts as cash
 * (`PORTFOLIO.cashLike`) form one block the lens can zoom past, so the
 * invested part can be read at full size.
 */
export type ColourBy = "day" | "return"

export type Tile = {
  /** The symbol, or `cashKey(currency)` for cash (the row's key too). */
  key: string
  label: string
  name: string
  logo: string | null
  /** Cash in a currency, drawn hatched. */
  cash: boolean
  /** Set aside by the lens: cash, and the funds named as cash-like. */
  cashLike: boolean
  weight: number
  /** The last session's move, and the position's return since bought. */
  move: number | null
  performance: number | null
  /** 0–4 by the picked measure, and its sign. */
  level: number
  dir: "up" | "down" | "flat"
}

/** A key for cash in a currency that no ticker can collide with. */
export const cashKey = (currency: string) => `cash:${currency}`

/** Where each grade starts: a session moves in tenths of what a position
 *  does over its life, so the two read on scales of their own. */
export const TILE_STEPS: Record<ColourBy, number[]> = {
  day: [0.0025, 0.01, 0.025, 0.05],
  return: [0.01, 0.05, 0.1, 0.2],
}

export function tileLevel(value: number | null, by: ColourBy): number {
  if (value === null) return 0
  return TILE_STEPS[by].filter((step) => Math.abs(value) >= step).length
}

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" })

/** A currency's English name, or its code. */
export function currencyName(currency: string): string {
  try {
    return currencyNames.of(currency) ?? currency
  } catch {
    return currency
  }
}

/** The account's tiles, heaviest first, cash last. */
export function allocTiles(
  site: Site,
  rows: Row[],
  cash: SiteCash[],
  cashLike: readonly string[],
  by: ColourBy,
): Tile[] {
  const symbols = new Map(site.symbols.map((entry) => [entry.symbol, entry]))
  const last = site.days.length - 1
  const held = rows.map((row): Tile => {
    const closes = symbols.get(row.symbol)?.closes ?? []
    const move = last > 0 ? change(closes, last - 1, last) : null
    const value = by === "day" ? move : row.performance
    const level = tileLevel(value, by)
    return {
      key: row.symbol,
      label: row.symbol,
      name: row.name,
      logo: row.logo,
      cash: false,
      cashLike: cashLike.includes(row.symbol),
      weight: row.weight,
      move,
      performance: row.performance,
      level,
      dir: level === 0 ? "flat" : direction(value),
    }
  })
  held.sort((a, b) => b.weight - a.weight)
  const money = cash.map(
    (entry): Tile => ({
      key: cashKey(entry.currency),
      label: entry.currency,
      name: currencyName(entry.currency),
      logo: null,
      cash: true,
      cashLike: true,
      weight: entry.weight,
      move: null,
      performance: null,
      level: 0,
      dir: "flat",
    }),
  )
  return [...held, ...money.sort((a, b) => b.weight - a.weight)]
}

/** The two blocks' shares of the account. */
export function allocShares(tiles: Tile[]) {
  let cashLike = 0
  let invested = 0
  for (const tile of tiles) {
    if (tile.cashLike) cashLike += tile.weight
    else invested += tile.weight
  }
  return { cashLike, invested }
}

/** The lens has something to do only with both blocks there. */
export const canZoom = (tiles: Tile[]) =>
  tiles.some((tile) => tile.cashLike) && tiles.some((tile) => !tile.cashLike)

export const TILE_GAP = 3

export type AllocLayout = {
  tiles: Record<string, Rect>
  /** The two blocks on the whole account (the lens's target, and where
   *  the cash-like money sits). */
  cashLike: Rect | null
  invested: Rect | null
  zoomed: boolean
}

/**
 * Every tile's rectangle in a `width` × `height` frame. On the whole
 * account the cash-like block and the invested one are each a single
 * rectangle; zoomed, the invested tiles fill the frame and the cash-like
 * ones ride the same zoom out of it, so a move between the two reads as
 * one camera move.
 */
export function allocLayout(
  tiles: Tile[],
  width: number,
  height: number,
  zoomed: boolean,
): AllocLayout {
  const frame: Rect = { x0: 0, y0: 0, x1: width, y1: height }
  const aside = tiles.filter((tile) => tile.cashLike)
  const kept = tiles.filter((tile) => !tile.cashLike)
  const groups = [aside, kept].filter((group) => group.length)
  const sum = (group: Tile[]) => group.reduce((s, tile) => s + tile.weight, 0)
  const blocks = inset(squarify(groups.map(sum), frame), frame, TILE_GAP)
  const placed: Record<string, Rect> = {}
  let cashLike: Rect | null = null
  let invested: Rect | null = null
  groups.forEach((group, i) => {
    const block = blocks[i]
    if (group === aside) cashLike = block
    else invested = block
    const cells = inset(
      squarify(
        group.map((tile) => tile.weight),
        block,
      ),
      block,
      TILE_GAP,
    )
    group.forEach((tile, j) => {
      placed[tile.key] = cells[j]
    })
  })
  const target = invested as Rect | null
  if (!zoomed || !cashLike || !target) {
    return { tiles: placed, cashLike, invested, zoomed: false }
  }
  const sx = width / Math.max(1, target.x1 - target.x0)
  const sy = height / Math.max(1, target.y1 - target.y0)
  const lens: Record<string, Rect> = {}
  const cells = inset(
    squarify(
      kept.map((tile) => tile.weight),
      frame,
    ),
    frame,
    TILE_GAP,
  )
  kept.forEach((tile, i) => {
    lens[tile.key] = cells[i]
  })
  for (const tile of aside) {
    const at = placed[tile.key]
    lens[tile.key] = {
      x0: (at.x0 - target.x0) * sx,
      y0: (at.y0 - target.y0) * sy,
      x1: (at.x1 - target.x0) * sx,
      y1: (at.y1 - target.y0) * sy,
    }
  }
  return { tiles: lens, cashLike, invested, zoomed: true }
}

/** Geist Mono's advance, in em, for fitting a tile's text. */
const ADVANCE = 0.6

/**
 * What a tile can carry: the ticker at 16px over its figure at 14, at 14
 * over 12, the ticker alone at 12, or nothing (the card has it).
 */
export function tileText(
  label: string,
  figure: string | null,
  width: number,
  height: number,
): { size: 12 | 14 | 16; figure: boolean } | null {
  const fits = (text: string, size: number) =>
    text.length * ADVANCE * size + 8 <= width
  if (figure === null) {
    // A label alone: the largest size its line fits.
    if (width >= 96 && height >= 28 && fits(label, 16))
      return { size: 16, figure: false }
    if (width >= 58 && height >= 24 && fits(label, 14))
      return { size: 14, figure: false }
  } else {
    if (width >= 96 && height >= 58 && fits(label, 16) && fits(figure, 14))
      return { size: 16, figure: true }
    if (width >= 58 && height >= 40 && fits(label, 14) && fits(figure, 12))
      return { size: 14, figure: true }
  }
  if (height >= 20 && fits(label, 12)) return { size: 12, figure: false }
  return null
}

/** The figure under a holding's ticker, by the measure; cash prints none
 *  (it neither moves nor returns, and its weight is its area). */
export function tileFigure(tile: Tile, by: ColourBy): string | null {
  if (tile.cash) return null
  const value = by === "day" ? tile.move : tile.performance
  if (value === null) return "—"
  return by === "day" ? formatReturn(value) : formatReturn(value, 1)
}

export type TileCard = {
  title: string
  name: string
  /** The session the move belongs to. */
  when: string | null
  rows: { label: string; value: string; dir: "up" | "down" | "flat" | null }[]
}

/** The card a hovered tile shows. */
export function tileCard(site: Site, tile: Tile): TileCard {
  const weight = {
    label: "Weight",
    value: formatWeight(tile.weight),
    dir: null,
  }
  if (tile.cash) {
    return { title: "Cash", name: tile.name, when: null, rows: [weight] }
  }
  return {
    title: tile.label,
    name: tile.name,
    when: monthDay.format(dayInstant(site.days[site.days.length - 1])),
    rows: [
      weight,
      {
        label: "Last session",
        value: tile.move === null ? "—" : formatReturn(tile.move),
        dir: tile.move === null ? null : direction(tile.move),
      },
      {
        label: "Return",
        value:
          tile.performance === null ? "—" : formatReturn(tile.performance, 1),
        dir: tile.performance === null ? null : direction(tile.performance),
      },
    ],
  }
}

/** The map's text alternative: every tile and its weight. */
export const allocLabel = (tiles: Tile[]) =>
  `Allocation: ${tiles
    .map(
      (tile) =>
        `${tile.cash ? `Cash ${tile.label}` : tile.label} ${formatWeight(tile.weight)}`,
    )
    .join(", ")}`
