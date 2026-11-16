/**
 * The Portfolio's return arithmetic, apart from the rest of its data
 * layer: what the money did over a range, the daily returns chained, the
 * strip's cells and how a return is printed. The home page's Now tile
 * draws the same figures from `/now/site`, and importing them from here
 * keeps `portfolio.ts` (the decoder, the table, the allocation map) out
 * of the home page's scripts. `portfolio.ts` re-exports everything here,
 * so /misc and the tests still read one module. Pure and browser-safe.
 */

import { dayInstant, monthDay } from "./feed"

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

/** An account's two ratios on the axis: its value and the money put in. */
export type Capital = {
  value: (number | null)[]
  invested: (number | null)[]
}

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

export const MINUS = "−"

export const monthYear = new Intl.DateTimeFormat("en-US", {
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

export const direction = (value: number | null) =>
  value === null
    ? "flat"
    : value > 5e-5
      ? "up"
      : value < -5e-5
        ? "down"
        : "flat"
