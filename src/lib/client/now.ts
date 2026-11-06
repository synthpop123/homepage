/**
 * Data layer for the home page's Now section: types for cf-workers-api's
 * /now/site view (see src/services/now/ there), the latest listen, the
 * latest film, today's token totals with the last two weeks and the
 * week's busiest model, and the portfolio's last three months, plus the decoder Now.astro validates
 * against and every line of text and every shape the tiles draw. Pure and
 * browser-safe.
 */

import {
  dayInstant,
  daysBetween,
  fetchJson,
  isCalendarDay,
  isCount,
  isRecord,
  monthDay,
  shiftDays,
  swr,
} from "./feed"
import { isFilm, type SiteFilm } from "./movies"
import { isListen, type SiteListen } from "./music"
import {
  direction,
  formatReturn,
  grainFor,
  growth,
  moneyReturns,
  type StripCell,
  stripCells,
} from "./portfolio"
import { formatCost, formatCount, formatTokens } from "./tokens/format"
import { modelLabel } from "./tokens/labels"

type TokensToday = {
  tokens: number
  cost: number
  messages: number
  /** Token totals of the last two weeks, oldest first, the payload's day
   *  last (`tokens`); a day with nothing reported is 0. */
  recent: number[]
  /** The model with the most tokens over the last seven days and its
   *  share of them, 0–1; null when the week has none. */
  top: { model: string; share: number } | null
}

/** The whole portfolio over /misc's 3M range: the session the range is
 *  measured from through the latest, measured as /misc measures it. */
type Portfolio = {
  /** Market sessions, oldest first. */
  days: string[]
  /** Value and money put in on `days`: the portfolio view's ratios. */
  value: number[]
  invested: number[]
  /** The S&P 500 fund's closes on `days`. */
  benchmark: number[]
}

export type Site = {
  schemaVersion: number
  today: string
  listen: SiteListen | null
  film: SiteFilm | null
  tokens: TokensToday | null
  portfolio: Portfolio | null
}

/** Lockstep with cf-workers-api's SITE_VERSION in src/services/now/index.ts. */
export const SITE_SCHEMA_VERSION = 5

const isTop = (value: unknown): value is TokensToday["top"] =>
  value === null ||
  (isRecord(value) &&
    typeof value.model === "string" &&
    value.model.length > 0 &&
    typeof value.share === "number" &&
    value.share > 0 &&
    value.share <= 1)

const isTokens = (value: unknown): value is TokensToday =>
  isRecord(value) &&
  isCount(value.tokens) &&
  isCount(value.cost) &&
  isCount(value.messages) &&
  Array.isArray(value.recent) &&
  value.recent.length > 0 &&
  value.recent.every(isCount) &&
  isTop(value.top)

const isLevel = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0

const isSeries = (
  value: unknown,
  length: number,
  is: (entry: unknown) => boolean = isLevel,
): value is number[] =>
  Array.isArray(value) && value.length === length && value.every(is)

const isReal = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)

const isPortfolio = (value: unknown): value is Portfolio =>
  isRecord(value) &&
  Array.isArray(value.days) &&
  value.days.length >= 2 &&
  value.days.every(isCalendarDay) &&
  isSeries(value.value, value.days.length, isCount) &&
  isSeries(value.invested, value.days.length, isReal) &&
  isSeries(value.benchmark, value.days.length)

const nullOr =
  <T>(is: (value: unknown) => value is T) =>
  (value: unknown): value is T | null =>
    value === null || is(value)

export function isSite(data: unknown): data is Site {
  return (
    isRecord(data) &&
    data.schemaVersion === SITE_SCHEMA_VERSION &&
    isCalendarDay(data.today) &&
    nullOr(isListen)(data.listen) &&
    nullOr(isFilm)(data.film) &&
    nullOr(isTokens)(data.tokens) &&
    nullOr(isPortfolio)(data.portfolio)
  )
}

export const loadSite = (
  endpoint: string,
  onData: (site: Site) => void,
): Promise<void> =>
  swr(
    `now:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => fetchJson<Site>(endpoint),
    isSite,
    onData,
  )

/** When a film was watched, against today: a diary day has no time, so
 *  this speaks in days ("today", "yesterday", "3d ago", "Sep 22"). */
export function watchedLabel(watched: string, today: string): string {
  const days = daysBetween(watched, today)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  return monthDay.format(dayInstant(watched))
}

/**
 * The tokens tile's label. The figure is the payload's day, which is
 * today only while the payload is: a cached copy painted after a failed
 * refresh, or a page left open past midnight, names its day instead of
 * passing yesterday's total off as today's.
 */
export function tokensLabel(day: string, today: string): string {
  if (day >= today) return "Tokens today"
  return daysBetween(day, today) === 1
    ? "Tokens yesterday"
    : `Tokens on ${monthDay.format(dayInstant(day))}`
}

/** ["$14.48", "155 messages"]: two runs, so a narrow tile can put the
 *  second on a line of its own instead of cutting it off. */
export const tokensFoot = ({
  cost,
  messages,
}: Pick<TokensToday, "tokens" | "cost" | "messages">) => [
  formatCost(cost),
  `${formatCount(messages)} ${messages === 1 ? "message" : "messages"}`,
]

/** "98% Claude Opus 5.5": the week's busiest model, its share first. */
export const topModelText = ({
  model,
  share,
}: {
  model: string
  share: number
}) => `${Math.round(share * 100)}% ${modelLabel(model)}`

export type TokenBar = { height: number; title: string }

/**
 * The tokens tile's bars, one a day ending on the payload's `day`. Heights
 * are the square root of each day's share of the busiest: a heavy day runs
 * to several times an ordinary one, and on a straight scale it would leave
 * the rest as slivers.
 */
export function tokenBars(recent: number[], day: string): TokenBar[] {
  const most = Math.max(0, ...recent)
  return recent.map((tokens, i) => ({
    height: most > 0 ? Math.sqrt(tokens / most) : 0,
    title: `${monthDay.format(
      dayInstant(shiftDays(day, i + 1 - recent.length)),
    )}: ${formatTokens(tokens)}`,
  }))
}

export type PortfolioView = {
  change: number
  dir: "up" | "down" | "flat"
  /** `+12.89%`. */
  figure: string
  /** ["S&P 500 +2.59%"]. */
  foot: string[]
  /** The link's tooltip: the range's days and both returns. */
  title: string
  /** Polyline points in a 100 × 100 box, y down: the portfolio's return,
   *  and the same money's in the benchmark; `area` closes the first. */
  line: string
  ghost: string
  area: string
  /** Where the first day sits, and the last (0–100, from the top). */
  base: number
  end: number
  /** The line again as day cells, graded as /misc grades its strip. */
  cells: (StripCell & { dir: "up" | "down" | "flat" })[]
  /** The axis' two ends. */
  from: string
  to: string
}

const round = (value: number) => Math.round(value * 100) / 100

export function portfolioView(portfolio: Portfolio): PortfolioView {
  const { days, benchmark } = portfolio
  const returns = moneyReturns(portfolio, 0)
  const ghost = moneyReturns(portfolio, 0, benchmark) as number[]
  const change = returns[returns.length - 1]
  const versus = ghost[ghost.length - 1]
  const low = Math.min(...returns, ...ghost)
  const high = Math.max(...returns, ...ghost)
  const pad = (high - low) * 0.08 || 0.01
  const y = (value: number) =>
    round(100 - ((value - low + pad) / (high - low + 2 * pad)) * 100)
  const x = (i: number) => round((i / (days.length - 1)) * 100)
  const points = (series: number[]) =>
    series.map((value, i) => `${x(i)},${y(value)}`).join(" ")
  const line = points(returns)
  const from = monthDay.format(dayInstant(days[0]))
  const to = monthDay.format(dayInstant(days[days.length - 1]))
  const benchmarkText = `S&P 500 ${formatReturn(versus)}`
  return {
    change,
    dir: direction(change),
    figure: formatReturn(change),
    foot: [benchmarkText],
    title: `Portfolio, ${from} – ${to}: ${formatReturn(change)}\n${benchmarkText}`,
    line,
    ghost: points(ghost),
    area: `0,100 ${line} 100,100`,
    base: y(0),
    end: y(change),
    cells: stripCells(
      days,
      growth(portfolio),
      0,
      grainFor(days.length - 1),
    ).map((cell) => ({ ...cell, dir: direction(cell.change) })),
    from,
    to,
  }
}
