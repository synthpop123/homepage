/**
 * Data layer for the Switch play-activity feed: types for switch-worker's
 * /api/site view (see switch-worker/src/site.ts) plus the payload decoder
 * the Switch.astro renderer validates against. Pure and browser-safe.
 */

import { swr, fetchJson, isRecord, isCount, isCalendarDay } from "./feed"

export type SiteStats = {
  totalMinutes: number
  gameCount: number
  daysActive: number
  daysTracked: number
  avgDailyMinutes: number
  longestStreak: number
  currentStreak: number
  firstDate: string | null
  lastPlayedDate: string | null
  /** List price of the played catalog in CNY, null while nothing is priced. */
  libraryValueCny: number | null
  /** How many titles carry a price — the value above is a floor, not a total. */
  pricedGameCount: number
}

export type SiteActivity = {
  date: string
  minutes: number
}

export type SiteGame = {
  applicationId: string
  title: string
  imageUrl: string | null
  shopUrl: string | null
  totalMinutes: number
  /** Minutes inside the payload's own `recentDays` window. */
  recentMinutes: number
  lastPlayedDate: string | null
}

export type Site = {
  schemaVersion: number
  today: string
  /** Nintendo's recalculation clock — the age of the data, not the cache. */
  observedAt: string | null
  recentDays: number
  stats: SiteStats
  activity: SiteActivity[]
  games: SiteGame[]
}

/** Lockstep with switch-worker SITE_VERSION in src/site.ts. */
export const SITE_SCHEMA_VERSION = 4

const isNullableDay = (value: unknown): value is string | null =>
  value === null || isCalendarDay(value)

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string"

const isNullableCount = (value: unknown): value is number | null =>
  value === null || isCount(value)

const isStats = (value: unknown): value is SiteStats =>
  isRecord(value) &&
  isCount(value.totalMinutes) &&
  isCount(value.gameCount) &&
  isCount(value.daysActive) &&
  isCount(value.daysTracked) &&
  isCount(value.avgDailyMinutes) &&
  isCount(value.longestStreak) &&
  isCount(value.currentStreak) &&
  isNullableDay(value.firstDate) &&
  isNullableDay(value.lastPlayedDate) &&
  isNullableCount(value.libraryValueCny) &&
  isCount(value.pricedGameCount)

const isActivity = (value: unknown): value is SiteActivity =>
  isRecord(value) && isCalendarDay(value.date) && isCount(value.minutes)

const isGame = (value: unknown): value is SiteGame =>
  isRecord(value) &&
  typeof value.applicationId === "string" &&
  typeof value.title === "string" &&
  isNullableString(value.imageUrl) &&
  isNullableString(value.shopUrl) &&
  isCount(value.totalMinutes) &&
  isCount(value.recentMinutes) &&
  isNullableDay(value.lastPlayedDate)

export function isSite(data: unknown): data is Site {
  if (!isRecord(data)) return false
  return (
    data.schemaVersion === SITE_SCHEMA_VERSION &&
    isCalendarDay(data.today) &&
    isNullableString(data.observedAt) &&
    isCount(data.recentDays) &&
    isStats(data.stats) &&
    Array.isArray(data.activity) &&
    data.activity.every(isActivity) &&
    Array.isArray(data.games) &&
    data.games.every(isGame)
  )
}

const shiftDay = (day: string, delta: number) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

/**
 * A contiguous `days`-long window ending on `today`, zero-filled.
 *
 * The payload's series starts at the first day with play, which is all it
 * can honestly claim — but the heatmap is a fixed grid, so a short series
 * draws a handful of cells floating in an empty frame instead of a year of
 * gray. Padding is a rendering concern, so it happens here and not upstream.
 */
export function heatmapWindow(
  activity: SiteActivity[],
  today: string,
  days: number,
): SiteActivity[] {
  const minutes = new Map(activity.map((day) => [day.date, day.minutes]))
  return Array.from({ length: days }, (_, index) => {
    const date = shiftDay(today, index - days + 1)
    return { date, minutes: minutes.get(date) ?? 0 }
  })
}

/**
 * How lately a title was played, relative to the payload's own `today`.
 * Days rather than a date: on a list ranked by lifetime hours the question
 * is whether something is still in rotation, not when it happened.
 */
export function lastPlayedLabel(
  lastPlayedDate: string | null,
  today: string,
): string | null {
  if (!lastPlayedDate) return null
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) -
      Date.parse(`${lastPlayedDate}T00:00:00Z`)) /
      86_400_000,
  )
  if (!Number.isFinite(days) || days < 0) return null
  if (days === 0) return "Played today"
  if (days === 1) return "Played yesterday"
  return `Played ${days} days ago`
}

/** Minutes as `12h 30m`, or `45m` below the hour. */
export function formatPlaytime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

const numberFormatter = new Intl.NumberFormat("en-US")
// zh-CN so the sign is a bare ¥ rather than en-US's "CN¥"; the note
// beside it is where the currency is spelled out.
const cnyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 0,
})

export type StatCard = { label: string; value: string; note: string }

/**
 * The four cards, in order. Prices are best-effort, so the third one falls
 * back to days active rather than showing a dash — and when it does carry a
 * value it admits how much of the library that value covers. `note` is
 * always a string so a refresh that lost its prices clears the old tooltip
 * instead of leaving it on a card that now says something else.
 */
export function statCards(stats: SiteStats): StatCard[] {
  const third: StatCard =
    stats.libraryValueCny !== null
      ? {
          label: "Library value",
          value: cnyFormatter.format(stats.libraryValueCny),
          note:
            stats.pricedGameCount < stats.gameCount
              ? `CNY, at eShop list price for ${stats.pricedGameCount} of ${stats.gameCount} titles`
              : "CNY, at eShop list price for every title played",
        }
      : {
          label: "Days active",
          value: numberFormatter.format(stats.daysActive),
          note: "",
        }
  return [
    { label: "Playtime", value: formatPlaytime(stats.totalMinutes), note: "" },
    {
      label: "Games",
      value: numberFormatter.format(stats.gameCount),
      note: "",
    },
    third,
    {
      label: "Per active day",
      value: formatPlaytime(stats.avgDailyMinutes),
      note: "",
    },
  ]
}

/**
 * The line under a title: how lately it was played, and — only when it is
 * less than the whole — how much of it fell in the recent window. On a
 * title played entirely inside the window the clause would restate the
 * amount beside it.
 */
export function rowFoot(
  game: SiteGame,
  recentDays: number,
  today: string,
): string {
  const parts = [lastPlayedLabel(game.lastPlayedDate, today)]
  if (game.recentMinutes > 0 && game.recentMinutes < game.totalMinutes)
    parts.push(`${formatPlaytime(game.recentMinutes)} in ${recentDays}d`)
  return parts.filter(Boolean).join(" · ")
}

export const loadSite = (
  endpoint: string,
  onData: (site: Site) => void,
): Promise<void> =>
  swr(
    `switch:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => fetchJson<Site>(`${endpoint}/api/site`),
    isSite,
    onData,
  )
