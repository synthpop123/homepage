/**
 * Data layer for the home page's Now section: types for cf-workers-api's
 * /now/site view (see src/services/now/ there), the latest listen, the
 * latest film, today's token totals and the newest memo, plus the decoder
 * Now.astro validates against and every line of text the tiles print.
 * Pure and browser-safe.
 */

import {
  fetchJson,
  isCalendarDay,
  isCount,
  isRecord,
  safeHttpUrl,
  swr,
  TIME_ZONE,
} from "./feed"
import { isFilm, type SiteFilm } from "./movies"
import { isListen, type SiteListen } from "./music"
import { formatCost, formatCount } from "./tokens/format"

export type TokensToday = { tokens: number; cost: number; messages: number }

export type Memo = {
  /** ISO instant the status was posted. */
  at: string
  url: string
  /** Plain text: the content warning when `cw`, else the body. */
  text: string
  cw: boolean
  /** Attachments of any kind. */
  media: number
}

export type Site = {
  schemaVersion: number
  today: string
  listen: SiteListen | null
  film: SiteFilm | null
  tokens: TokensToday | null
  memo: Memo | null
}

/** Lockstep with cf-workers-api's SITE_VERSION in src/services/now/index.ts. */
export const SITE_SCHEMA_VERSION = 1

const isTokens = (value: unknown): value is TokensToday =>
  isRecord(value) &&
  isCount(value.tokens) &&
  isCount(value.cost) &&
  isCount(value.messages)

const isMemo = (value: unknown): value is Memo =>
  isRecord(value) &&
  typeof value.at === "string" &&
  !Number.isNaN(Date.parse(value.at)) &&
  safeHttpUrl(value.url) !== null &&
  typeof value.text === "string" &&
  typeof value.cw === "boolean" &&
  isCount(value.media)

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
    nullOr(isMemo)(data.memo)
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

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: TIME_ZONE,
})

/**
 * "just now" / "12m ago" / "3h ago" / "yesterday" / "4d ago", then the
 * date: past a week, a count of days is arithmetic the reader has to do.
 * "yesterday" counts elapsed hours, not calendar days, like the rest.
 */
export function ago(at: string | Date, now = Date.now()): string {
  const then = typeof at === "string" ? Date.parse(at) : at.getTime()
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 2) return "yesterday"
  if (days < 7) return `${days}d ago`
  return shortDate.format(then)
}

/** A calendar day as the instant it began in the site's zone. */
const dayStart = (day: string) => new Date(`${day}T00:00:00+08:00`)

/** When a film was watched, against today: a diary day has no time, so
 *  this speaks in days ("today", "yesterday", "3d ago", "Sep 22"). */
export function watchedLabel(watched: string, today: string): string {
  const days = Math.round(
    (dayStart(today).getTime() - dayStart(watched).getTime()) / 86_400_000,
  )
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  return shortDate.format(dayStart(watched))
}

/** ["$14.48", "155 messages"]: two runs, so a narrow tile can put the
 *  second on a line of its own instead of cutting it off. */
export const tokensFoot = ({ cost, messages }: TokensToday) => [
  formatCost(cost),
  `${formatCount(messages)} ${messages === 1 ? "message" : "messages"}`,
]

/**
 * What the memo tile says: the text, or for a status that is only
 * attachments, how many ("3 photos" reads as a post, "" as a bug). A
 * content warning is shown as one, never the body behind it.
 */
export function memoText({ text, cw, media }: Memo): string {
  if (cw) return `CW: ${text}`
  if (text) return text
  if (media === 0) return "(empty)"
  return media === 1 ? "1 attachment" : `${media} attachments`
}
