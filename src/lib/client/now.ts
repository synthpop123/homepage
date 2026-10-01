/**
 * Data layer for the home page's Now section: types for cf-workers-api's
 * /now/site view (see src/services/now/ there), the latest listen, the
 * latest film, today's token totals and the last flight, plus the decoder
 * Now.astro validates against and every line of text the tiles print.
 * Pure and browser-safe.
 */

import {
  dayInstant,
  daysBetween,
  fetchJson,
  isCalendarDay,
  isCount,
  isRecord,
  monthDay,
  swr,
  TIME_ZONE,
} from "./feed"
import { formatDuration, formatKm } from "./flights"
import { isFilm, type SiteFilm } from "./movies"
import { isListen, type SiteListen } from "./music"
import { formatCost, formatCount } from "./tokens/format"

type TokensToday = { tokens: number; cost: number; messages: number }

type Place = { code: string; city: string | null }

type Flight = {
  /** The calendar day flown. */
  date: string
  /** In the direction flown. */
  from: Place
  to: Place
  km: number
  minutes: number | null
  airline: string | null
  aircraft: string | null
}

export type Site = {
  schemaVersion: number
  today: string
  listen: SiteListen | null
  film: SiteFilm | null
  tokens: TokensToday | null
  flight: Flight | null
}

/** Lockstep with cf-workers-api's SITE_VERSION in src/services/now/index.ts. */
export const SITE_SCHEMA_VERSION = 2

const isTokens = (value: unknown): value is TokensToday =>
  isRecord(value) &&
  isCount(value.tokens) &&
  isCount(value.cost) &&
  isCount(value.messages)

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string"

const isPlace = (value: unknown): value is Place =>
  isRecord(value) &&
  typeof value.code === "string" &&
  isNullableString(value.city)

const isFlight = (value: unknown): value is Flight =>
  isRecord(value) &&
  isCalendarDay(value.date) &&
  isPlace(value.from) &&
  isPlace(value.to) &&
  isCount(value.km) &&
  (value.minutes === null || isCount(value.minutes)) &&
  isNullableString(value.airline) &&
  isNullableString(value.aircraft)

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
    nullOr(isFlight)(data.flight)
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
    : `Tokens · ${monthDay.format(dayInstant(day))}`
}

/** ["$14.48", "155 messages"]: two runs, so a narrow tile can put the
 *  second on a line of its own instead of cutting it off. */
export const tokensFoot = ({ cost, messages }: TokensToday) => [
  formatCost(cost),
  `${formatCount(messages)} ${messages === 1 ? "message" : "messages"}`,
]

const longDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: TIME_ZONE,
})

/** The day a flight was flown: "Aug 16", with the year only when it is
 *  not this one. A flight is rare enough that a count of days would be
 *  arithmetic, not news. */
export function flownLabel(date: string, today: string): string {
  const format = date.slice(0, 4) === today.slice(0, 4) ? monthDay : longDate
  return format.format(dayInstant(date))
}

/** A place by its city, or its code when the city is unknown. */
const placeName = ({ code, city }: Place) => city ?? code

/** ["Jiaxing → Beijing", "1,106 km"]: two runs, like `tokensFoot`. */
export const flightFoot = (flight: Flight) => [
  `${placeName(flight.from)} → ${placeName(flight.to)}`,
  formatKm(flight.km),
]

/** Everything the tile leaves out, for its tooltip: the date in full,
 *  the time aloft, the airline and the aircraft. */
export function flightTitle(flight: Flight): string {
  const parts = [
    longDate.format(dayInstant(flight.date)),
    formatKm(flight.km),
    flight.minutes === null ? null : formatDuration(flight.minutes),
    [flight.airline, flight.aircraft].filter(Boolean).join(", ") || null,
  ]
  return [
    `${placeName(flight.from)} → ${placeName(flight.to)}`,
    parts.filter(Boolean).join(" · "),
  ].join("\n")
}
