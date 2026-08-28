/**
 * Data layer for the Switch play-activity feed: types for switch-worker's
 * /api/site view (see switch-worker/src/site.ts) plus the payload decoder
 * the Switch.astro renderer validates against. Pure and browser-safe.
 */

import { cached, fetchJson } from "./feed"

export type SiteStats = {
  totalMinutes: number
  gameCount: number
  daysActive: number
  avgDailyMinutes: number
  longestStreak: number
}

export type SiteActivity = {
  date: string
  minutes: number
}

export type SiteRecentGame = {
  applicationId: string
  title: string
  imageUrl: string | null
  lastPlayedAt: string | null
  totalMinutes: number
}

export type Site = {
  schemaVersion: number
  generatedAt: string
  today: string
  stats: SiteStats
  activity: SiteActivity[]
  recent: SiteRecentGame[]
}

/** Lockstep with switch-worker SITE_VERSION in src/site.ts. */
export const SITE_SCHEMA_VERSION = 1

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const isCalendarDay = (value: unknown): value is string =>
  typeof value === "string" && DATE_RE.test(value)

const isStats = (value: unknown): value is SiteStats =>
  isRecord(value) &&
  isCount(value.totalMinutes) &&
  isCount(value.gameCount) &&
  isCount(value.daysActive) &&
  isCount(value.avgDailyMinutes) &&
  isCount(value.longestStreak)

const isActivity = (value: unknown): value is SiteActivity =>
  isRecord(value) && isCalendarDay(value.date) && isCount(value.minutes)

const isRecentGame = (value: unknown): value is SiteRecentGame =>
  isRecord(value) &&
  typeof value.applicationId === "string" &&
  typeof value.title === "string" &&
  (value.imageUrl === null || typeof value.imageUrl === "string") &&
  (value.lastPlayedAt === null || typeof value.lastPlayedAt === "string") &&
  isCount(value.totalMinutes)

export function isSite(data: unknown): data is Site {
  if (!isRecord(data)) return false
  return (
    data.schemaVersion === SITE_SCHEMA_VERSION &&
    typeof data.generatedAt === "string" &&
    Number.isFinite(Date.parse(data.generatedAt)) &&
    isCalendarDay(data.today) &&
    isStats(data.stats) &&
    Array.isArray(data.activity) &&
    data.activity.every(isActivity) &&
    Array.isArray(data.recent) &&
    data.recent.every(isRecentGame)
  )
}

export const loadSite = (endpoint: string): Promise<Site> =>
  cached(
    `switch:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => fetchJson<Site>(`${endpoint}/api/site`),
    isSite,
  )
