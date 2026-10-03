/**
 * Data layer for the Music section: types for cf-workers-api's /music/site
 * view (see src/services/music/compose.ts there) — Koito's stats, listen
 * activity and latest listens composed into one snapshot — delivered in
 * the /misc bundle, plus the decoder Music.astro validates against. Pure
 * and browser-safe.
 */

import { isCalendarDay, isCount, isRecord, safeHttpUrl, swr } from "./feed"
import { miscSection } from "./misc"

export type SiteStats = {
  plays: number
  tracks: number
  albums: number
  artists: number
  minutes: number
  daysActive: number
  avgDailyPlays: number
  longestStreak: number
}

export type SiteListen = {
  /** ISO instant the listen was scrobbled. */
  at: string
  title: string
  artists: string[]
  url: string
  /** ~128px and ~300px renditions; the lead row takes the larger. */
  cover: { small: string | null; medium: string | null }
}

export type Site = {
  schemaVersion: number
  today: string
  stats: SiteStats
  /** Dense and chronological, ending `today` — the heatmap's contract. */
  activity: { date: string; plays: number }[]
  listens: SiteListen[]
}

/** Lockstep with cf-workers-api's SITE_VERSION in src/services/music/compose.ts. */
export const SITE_SCHEMA_VERSION = 1

export const STAT_KEYS = [
  "plays",
  "tracks",
  "albums",
  "artists",
  "minutes",
  "daysActive",
  "avgDailyPlays",
  "longestStreak",
] as const satisfies readonly (keyof SiteStats)[]

const isNullableUrl = (value: unknown): value is string | null =>
  value === null || safeHttpUrl(value) !== null

const isStats = (value: unknown): value is SiteStats =>
  isRecord(value) && STAT_KEYS.every((key) => isCount(value[key]))

const isDay = (value: unknown) =>
  isRecord(value) && isCalendarDay(value.date) && isCount(value.plays)

export const isListen = (value: unknown): value is SiteListen =>
  isRecord(value) &&
  typeof value.at === "string" &&
  !Number.isNaN(Date.parse(value.at)) &&
  typeof value.title === "string" &&
  Array.isArray(value.artists) &&
  value.artists.every((artist) => typeof artist === "string") &&
  safeHttpUrl(value.url) !== null &&
  isRecord(value.cover) &&
  isNullableUrl(value.cover.small) &&
  isNullableUrl(value.cover.medium)

export function isSite(data: unknown): data is Site {
  if (!isRecord(data)) return false
  return (
    data.schemaVersion === SITE_SCHEMA_VERSION &&
    isCalendarDay(data.today) &&
    isStats(data.stats) &&
    Array.isArray(data.activity) &&
    data.activity.every(isDay) &&
    Array.isArray(data.listens) &&
    data.listens.every(isListen)
  )
}

/** "1 play", "1,204 plays". */
export const formatPlays = (plays: number) =>
  `${plays.toLocaleString("en-US")} ${plays === 1 ? "play" : "plays"}`

/** Within this many minutes the lead listen counts as just played. */
const RECENT_MINUTES = 10

/** Whether a listen at `at` is recent enough to spin the lead record. */
export const isPlaying = (at: string, now = Date.now()) =>
  (now - Date.parse(at)) / 60_000 < RECENT_MINUTES

export const loadSite = (
  endpoint: string,
  onData: (site: Site) => void,
): Promise<void> =>
  swr(
    `music:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => miscSection(endpoint, "music") as Promise<Site>,
    isSite,
    onData,
  )
