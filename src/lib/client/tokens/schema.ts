/** The versioned /api/site contract and its runtime decoder. */
import { isRecord, isCount, isCalendarDay } from "../feed"

export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  tokens: number
  messages: number
  cost: number
}

/** Usage span of a breakdown row inside its range. */
export type UsageSpan = {
  days: number
  firstDate: string | null
  lastDate: string | null
}

/** One cell of the client × model or provider × model matrix: what a
 *  client or a vendor spent on a single model, inside one range. Leaner
 *  than a breakdown row on purpose — a disclosure shows a share, not a
 *  second full breakdown. */
export type ModelCell = {
  model: string
  tokens: number
  cost: number
  messages: number
}

export type SiteRange = {
  from: string | null
  totals: Usage & {
    activeDays: number
    firstDate: string | null
    lastDate: string | null
  }
  byModel: (Usage & UsageSpan & { model: string; providers: string[] })[]
  byClient: (Usage & UsageSpan & { client: string; models: ModelCell[] })[]
  byProvider: (Usage & UsageSpan & { provider: string; models: ModelCell[] })[]
}

export type DaySlice = { tokens: number; cost: number }

export type SiteDay = {
  date: string
  tokens: number
  cost: number
  messages: number
  /** Wall-clock active time (ms) summed across devices; only present on
   *  days the CLI reported it. */
  active?: number
  providers: Record<string, DaySlice>
  clients: Record<string, DaySlice>
  /** Keyed by *canonical* model id, so the slices agree with
   *  `ranges.*.byModel`. */
  models: Record<string, DaySlice>
}

export type SiteDevice = {
  name: string
  firstSeen: number | null
  lastSeen: number | null
  cliVersion: string | null
  sessions: number | null
  activeMs: number | null
  longestMs: number | null
  maxConcurrent: number | null
  mcpServers: string[] | null
  activeDays: number
  tokens: number
  messages: number
  cost: number
}

/** One rate-limit window of a subscription. `resetsAt` is absolute, so a
 *  window that has since rolled over is recognisable as reset rather
 *  than read as a stale percentage. OpenAI still sends a timestamp at
 *  0% spend — either the unused placeholder (`capturedAt + window`) or
 *  an anchored window whose remaining is already shorter; the quota
 *  card tells those apart rather than keying on `usedPercent` alone. */
export type QuotaWindow = {
  label: string
  usedPercent: number
  resetsAt: string | null
}

/**
 * One subscription's quota — the part of the payload the collector is
 * *told* rather than deriving from session logs. Each plan is read from
 * a different vendor on its own timer, so each dates itself: one card
 * can be a minute old while the other has been stuck for hours, and
 * `capturedAt` is what lets the section say so.
 */
export type QuotaPlan = {
  provider: string
  label: string
  plan: string | null
  capturedAt: string
  windows: QuotaWindow[]
  /** Expiry of each unspent manual reset, ascending. Empty for plans
   *  with no such thing — Claude has none. */
  resetCredits: string[]
}

export type Site = {
  schemaVersion: number
  /** Reporter freshness threshold owned by the collector; age against the current clock. */
  deviceOnlineWithinMs: number
  generatedAt: string
  today: string
  /** One entry per subscription a collector has reported; empty until
   *  one has. */
  quota: QuotaPlan[]
  ranges: Record<RangeKey, SiteRange>
  daily: SiteDay[]
  devices: SiteDevice[]
}

/**
 * The /api/site schema version this dashboard is built against, in
 * lockstep with tokens-worker's SITE_VERSION. The collector stamps its
 * payload and bumps on any shape or semantics change; isSite rejects
 * anything else, so a stale cache or a mid-deploy mismatch falls back to
 * a refetch (or the fallback UI) instead of a renderer crash. This
 * number is also the sessionStorage cache key, so a deploy never reads
 * the previous build's entries.
 */
export const SITE_SCHEMA_VERSION = 13

export type RangeKey = "day" | "week" | "month" | "quarter" | "all"
export type MetricKey = "tokens" | "cost"

/**
 * The ranges the selector offers. `day` is deliberately not among them:
 * it is the collector's today-only window, and it backs the standalone
 * Today section (the only per-model split of a single day the payload
 * carries) rather than the range-driven parts of the page.
 */
export const RANGES: {
  key: RangeKey
  label: string
  days: number | null
  default?: boolean
}[] = [
  { key: "week", label: "7 days", days: 7 },
  { key: "month", label: "30 days", days: 30, default: true },
  { key: "quarter", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
]

export const DEFAULT_RANGE = RANGES.find((entry) => entry.default)!

/** Every range key the payload carries — what the decoder validates. */
export const RANGE_KEYS: RangeKey[] = ["day", ...RANGES.map(({ key }) => key)]

/** The selector entry behind a range key. `day` is not one of them, so a
 *  miss falls back to the 30-day window the markup starts checked. */
export const rangeMeta = (key: RangeKey) =>
  RANGES.find((entry) => entry.key === key) ?? DEFAULT_RANGE

/** The five token categories, in display order (shade 1…5). */
export const COMPOSITION: { key: keyof Usage; label: string }[] = [
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
  { key: "reasoning", label: "Reasoning" },
]

/* Payload decoding ---------------------------------------------------- */

const isDateOrNull = (value: unknown): boolean =>
  value === null || isCalendarDay(value)

/** The full metric set every totals object and breakdown row carries. */
const hasUsage = (row: Record<string, unknown>): boolean =>
  COMPOSITION.every(({ key }) => isCount(row[key])) &&
  isCount(row.tokens) &&
  isCount(row.messages) &&
  isCount(row.cost)

const isSpanRow = (value: unknown, id: string): boolean =>
  isRecord(value) &&
  typeof value[id] === "string" &&
  hasUsage(value) &&
  isCount(value.days) &&
  isDateOrNull(value.firstDate) &&
  isDateOrNull(value.lastDate)

/** A daily providers/clients map the trend chart Object.entries() over. */
const isSlices = (value: unknown): boolean =>
  isRecord(value) &&
  Object.values(value).every(
    (slice) => isRecord(slice) && isCount(slice.tokens) && isCount(slice.cost),
  )

const isDay = (value: unknown): boolean =>
  isRecord(value) &&
  isCalendarDay(value.date) &&
  isCount(value.tokens) &&
  isCount(value.cost) &&
  isCount(value.messages) &&
  (value.active === undefined || isCount(value.active)) &&
  isSlices(value.providers) &&
  isSlices(value.clients) &&
  isSlices(value.models)

const isCountOrNull = (value: unknown): boolean =>
  value === null || isCount(value)

/**
 * Device rows are validated in full. The metadata fields render behind
 * truthiness guards, but their types still matter: a string mcpServers
 * has a truthy .length and no .join() — exactly the malformed-cache
 * crash this decoder exists to keep away from the renderers.
 */
const isDevice = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.name === "string" &&
  isCountOrNull(value.firstSeen) &&
  isCountOrNull(value.lastSeen) &&
  (value.cliVersion === null || typeof value.cliVersion === "string") &&
  isCountOrNull(value.sessions) &&
  isCountOrNull(value.activeMs) &&
  isCountOrNull(value.longestMs) &&
  isCountOrNull(value.maxConcurrent) &&
  (value.mcpServers === null ||
    (Array.isArray(value.mcpServers) &&
      value.mcpServers.every((item) => typeof item === "string"))) &&
  isCount(value.activeDays) &&
  isCount(value.tokens) &&
  isCount(value.messages) &&
  isCount(value.cost)

const isStringArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

/** An instant the renderer does arithmetic on, so it has to parse. */
const isInstant = (value: unknown): boolean =>
  typeof value === "string" && Number.isFinite(Date.parse(value))

/**
 * One reported plan. A plan with no windows would render as a heading
 * over nothing, so the list is required to be non-empty — the collector
 * rejects such a snapshot at the door, and this is the same rule on the
 * reading side. `capturedAt` has to parse: the card is aged by it, and
 * an undated card would present a stale number as current.
 */
const isQuotaPlan = (plan: unknown): boolean =>
  isRecord(plan) &&
  typeof plan.provider === "string" &&
  typeof plan.label === "string" &&
  (plan.plan === null || typeof plan.plan === "string") &&
  isInstant(plan.capturedAt) &&
  Array.isArray(plan.windows) &&
  plan.windows.length > 0 &&
  plan.windows.every(
    (window: unknown) =>
      isRecord(window) &&
      typeof window.label === "string" &&
      isCount(window.usedPercent) &&
      (window.resetsAt === null || isInstant(window.resetsAt)),
  ) &&
  isStringArray(plan.resetCredits)

/** The models a client or provider row splits into — rendered by the
 *  disclosure, so the shape matters as much as the numbers. */
const isModelCells = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every(
    (cell) =>
      isRecord(cell) &&
      typeof cell.model === "string" &&
      isCount(cell.tokens) &&
      isCount(cell.cost) &&
      isCount(cell.messages),
  )

const isRange = (value: unknown): boolean =>
  isRecord(value) &&
  isDateOrNull(value.from) &&
  isRecord(value.totals) &&
  hasUsage(value.totals) &&
  isCount(value.totals.activeDays) &&
  isDateOrNull(value.totals.firstDate) &&
  isDateOrNull(value.totals.lastDate) &&
  Array.isArray(value.byModel) &&
  value.byModel.every(
    (row) =>
      isSpanRow(row, "model") &&
      isStringArray((row as Record<string, unknown>).providers),
  ) &&
  Array.isArray(value.byClient) &&
  value.byClient.every(
    (row) =>
      isSpanRow(row, "client") &&
      isModelCells((row as Record<string, unknown>).models),
  ) &&
  Array.isArray(value.byProvider) &&
  value.byProvider.every(
    (row) =>
      isSpanRow(row, "provider") &&
      isModelCells((row as Record<string, unknown>).models),
  )

/**
 * Runtime decoder for the /api/site payload, strict over every field
 * the renderers actually read: the schema version (anything this build
 * does not accept is rejected outright), every reported quota plan, all
 * five ranges with their
 * totals and breakdown rows (metrics + usage spans), every daily row
 * including the provider/client/model slice maps the trend chart
 * iterates, and the device list down to its nullable metadata —
 * render-site truthiness guards handle absence, not wrong types. Dates
 * are held to the calendar-day shape and `generatedAt` to something
 * Date can actually parse: both are arithmetic inputs, not labels.
 */
export function isSite(data: unknown): data is Site {
  if (!isRecord(data)) return false
  const ranges = data.ranges
  return (
    data.schemaVersion === SITE_SCHEMA_VERSION &&
    isCount(data.deviceOnlineWithinMs) &&
    data.deviceOnlineWithinMs > 0 &&
    typeof data.generatedAt === "string" &&
    Number.isFinite(Date.parse(data.generatedAt)) &&
    isCalendarDay(data.today) &&
    Array.isArray(data.quota) &&
    data.quota.every(isQuotaPlan) &&
    isRecord(ranges) &&
    RANGE_KEYS.every((key) => isRange(ranges[key])) &&
    Array.isArray(data.daily) &&
    data.daily.every(isDay) &&
    Array.isArray(data.devices) &&
    data.devices.every(isDevice)
  )
}
