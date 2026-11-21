/**
 * Data layer for the Movies section: types for cf-workers-api's
 * /movies/site view (see src/services/movies/compose.ts there) — the
 * latest Letterboxd diary entries, posters mirrored to img.lkwplus.com —
 * delivered in the /misc bundle, plus the decoder Movies.astro validates
 * against. Pure and browser-safe.
 */

import { isCalendarDay, isCount, isRecord, safeHttpUrl, swr } from "./feed"
import { miscSection } from "./misc"

export type SiteFilm = {
  title: string
  year: number | null
  /** The member's page for this viewing. */
  url: string
  /** `YYYY-MM-DD`, the day it was logged as watched. */
  watched: string
  /** Half-star steps, 0.5–5; null when unrated. */
  rating: number | null
  rewatch: boolean
  poster: string | null
}

export type Site = {
  schemaVersion: number
  profileUrl: string
  /** Newest viewing first. */
  films: SiteFilm[]
}

/** Lockstep with cf-workers-api's SITE_VERSION in src/services/movies/compose.ts. */
export const SITE_SCHEMA_VERSION = 1

const isNullableCount = (value: unknown): value is number | null =>
  value === null || isCount(value)

export const isFilm = (value: unknown): value is SiteFilm =>
  isRecord(value) &&
  typeof value.title === "string" &&
  isNullableCount(value.year) &&
  safeHttpUrl(value.url) !== null &&
  isCalendarDay(value.watched) &&
  isNullableCount(value.rating) &&
  typeof value.rewatch === "boolean" &&
  (value.poster === null || safeHttpUrl(value.poster) !== null)

/** Below this a title fits its card whole, so it is never split. */
const SPLIT_FROM = 21

/**
 * A long title as its head and subtitle, cut at the first colon
 * ("The Hunger Games: Sunrise on the Reaping"), so the card can always
 * show the head whole and let only the subtitle run out of room. A
 * short title, or one with no colon or nothing on one side of it, stays
 * whole: "Mission: Impossible" is a name, not a head and a subtitle.
 */
export function splitTitle(title: string): {
  head: string
  sub: string | null
} {
  const whole = { head: title, sub: null }
  if (title.length < SPLIT_FROM) return whole
  const match = /\s*[:：]\s*/.exec(title)
  if (!match) return whole
  const head = title.slice(0, match.index).trim()
  const sub = title.slice(match.index + match[0].length).trim()
  return head && sub ? { head, sub } : whole
}

export function isSite(data: unknown): data is Site {
  if (!isRecord(data)) return false
  return (
    data.schemaVersion === SITE_SCHEMA_VERSION &&
    safeHttpUrl(data.profileUrl) !== null &&
    Array.isArray(data.films) &&
    data.films.every(isFilm)
  )
}

export const loadSite = (
  endpoint: string,
  onData: (site: Site) => void,
): Promise<void> =>
  swr(
    `movies:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => miscSection(endpoint, "movies") as Promise<Site>,
    isSite,
    onData,
  )
