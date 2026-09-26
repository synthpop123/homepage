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

const isFilm = (value: unknown): value is SiteFilm =>
  isRecord(value) &&
  typeof value.title === "string" &&
  isNullableCount(value.year) &&
  safeHttpUrl(value.url) !== null &&
  isCalendarDay(value.watched) &&
  isNullableCount(value.rating) &&
  typeof value.rewatch === "boolean" &&
  (value.poster === null || safeHttpUrl(value.poster) !== null)

export function isSite(data: unknown): data is Site {
  if (!isRecord(data)) return false
  return (
    data.schemaVersion === SITE_SCHEMA_VERSION &&
    safeHttpUrl(data.profileUrl) !== null &&
    Array.isArray(data.films) &&
    data.films.every(isFilm)
  )
}

/** A calendar day as the instant it began in the site's zone, so the
 *  shared formatters (which render in TIME_ZONE) print that same day. */
export const watchedInstant = (day: string) => new Date(`${day}T00:00:00+08:00`)

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
