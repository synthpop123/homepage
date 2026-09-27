/**
 * Data layer for the Flights section: types for cf-workers-api's
 * /flights/site view (see src/services/flights/compose.ts there), delivered
 * in the /misc bundle, the payload decoder, and every
 * render decision that isn't DOM: the stat cards, the composition bars,
 * and the map's plane geometry (arc curves, where labels go, which
 * airports share a magnifier and which corner it sits in). The projection
 * itself is d3-geo's, in flights-feed/map.ts. Pure and browser-safe.
 */

import { isCalendarDay, isCount, isRecord, swr } from "./feed"
import { miscSection } from "./misc"

export type SiteAirport = {
  code: string
  name: string
  city: string | null
  country: string | null
  lat: number
  lon: number
  /** Departures plus arrivals among flights already flown. */
  visits: number
}

export type SiteRoute = {
  /** The pair in code order: flown either way, drawn once. */
  from: string
  to: string
  /** Flights flown along it, either direction. */
  flights: number
  /** Flights logged ahead of `today`. */
  upcoming: number
  km: number
  /** Mean minutes over the flights whose duration is known. */
  minutes: number | null
}

export type SiteCount = {
  code: string | null
  name: string
  flights: number
}

export type SiteStats = {
  flights: number
  upcoming: number
  km: number
  minutes: number
  airports: number
  countries: number
  airlines: number
  aircraftTypes: number
  routes: number
  firstDate: string | null
  lastDate: string | null
}

export type Site = {
  schemaVersion: number
  today: string
  stats: SiteStats
  /** Most visited first. */
  airports: SiteAirport[]
  /** Most flown first, then longest. */
  routes: SiteRoute[]
  /** Most flown first. */
  airlines: SiteCount[]
  aircraft: SiteCount[]
}

/** Lockstep with cf-workers-api's SITE_VERSION in src/services/flights/compose.ts. */
export const SITE_SCHEMA_VERSION = 1

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string"

const isNullableDay = (value: unknown): value is string | null =>
  value === null || isCalendarDay(value)

const isDegrees = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Math.abs(value) <= limit

const isAirport = (value: unknown): value is SiteAirport =>
  isRecord(value) &&
  typeof value.code === "string" &&
  typeof value.name === "string" &&
  isNullableString(value.city) &&
  isNullableString(value.country) &&
  isDegrees(value.lat, 90) &&
  isDegrees(value.lon, 180) &&
  isCount(value.visits)

const isRoute = (value: unknown): value is SiteRoute =>
  isRecord(value) &&
  typeof value.from === "string" &&
  typeof value.to === "string" &&
  isCount(value.flights) &&
  isCount(value.upcoming) &&
  isCount(value.km) &&
  (value.minutes === null || isCount(value.minutes))

const isTally = (value: unknown): value is SiteCount[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item.name === "string" &&
      isNullableString(item.code) &&
      isCount(item.flights),
  )

const isStats = (value: unknown): value is SiteStats =>
  isRecord(value) &&
  isCount(value.flights) &&
  isCount(value.upcoming) &&
  isCount(value.km) &&
  isCount(value.minutes) &&
  isCount(value.airports) &&
  isCount(value.countries) &&
  isCount(value.airlines) &&
  isCount(value.aircraftTypes) &&
  isCount(value.routes) &&
  isNullableDay(value.firstDate) &&
  isNullableDay(value.lastDate)

/**
 * Strict, and one step further than the other feeds: every route has to
 * name airports the payload also lists, since the globe looks each end up
 * by code and a dangling one would have no place to draw.
 */
export function isSite(data: unknown): data is Site {
  if (!isRecord(data)) return false
  if (
    data.schemaVersion !== SITE_SCHEMA_VERSION ||
    !isCalendarDay(data.today) ||
    !isStats(data.stats) ||
    !Array.isArray(data.airports) ||
    !data.airports.every(isAirport) ||
    !Array.isArray(data.routes) ||
    !data.routes.every(isRoute) ||
    !isTally(data.airlines) ||
    !isTally(data.aircraft)
  )
    return false
  const codes = new Set(data.airports.map((airport) => airport.code))
  return data.routes.every(
    (route) => codes.has(route.from) && codes.has(route.to),
  )
}

/* Formatting ------------------------------------------------------------- */

const numberFormatter = new Intl.NumberFormat("en-US")

/** Minutes as `2h 15m`, `45m` below the hour. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

export const formatKm = (km: number) => `${numberFormatter.format(km)} km`

/** A route's two codes: it is flown either way, so it reads either way. */
export const routeLabel = (route: Pick<SiteRoute, "from" | "to">) =>
  `${route.from} ⇄ ${route.to}`

/** Once round the equator. */
export const EARTH_KM = 40_075

export type StatCard = {
  key: string
  label: string
  value: string
  foot: string
}

/**
 * The four readout cells: how many flights, how far, how long, and where.
 * What the flights were made of (routes, airlines, aircraft) has lists
 * and bars of its own under the map, so it is not repeated here.
 */
export function statCards(site: Site): StatCard[] {
  const { stats } = site
  const laps = stats.km / EARTH_KM
  const days = stats.minutes / (60 * 24)
  return [
    {
      key: "flights",
      label: "Flights",
      value: numberFormatter.format(stats.flights),
      foot: stats.firstDate ? `since ${stats.firstDate.slice(0, 4)}` : "",
    },
    {
      key: "distance",
      label: "Distance",
      value: formatKm(stats.km),
      foot: `${laps.toFixed(laps < 10 ? 2 : 1)}× around the Earth`,
    },
    {
      key: "airtime",
      label: "In the air",
      value: formatDuration(stats.minutes),
      foot: days >= 1 ? `≈ ${days.toFixed(1)} days aloft` : "under a day aloft",
    },
    {
      key: "airports",
      label: "Airports",
      value: numberFormatter.format(stats.airports),
      foot: `in ${stats.countries} ${stats.countries === 1 ? "country" : "countries"}`,
    },
  ]
}

/** A ranked row's bar: its share of the list's leader. */
export const share = (value: number, top: number) =>
  top > 0 ? Math.min(value / top, 1) : 0

/** The routes the list ranks: flown at least once, most flown first. */
export const flownRoutes = (site: Site) =>
  site.routes.filter((route) => route.flights > 0)

/**
 * A list cut after its first `named` items, the rest to fold behind a
 * "Show N more" row. A rest of one is shown instead, since a row that
 * reveals a single row saves nothing.
 */
export function fold<T>(items: T[], named: number): { named: T[]; rest: T[] } {
  if (items.length <= named + 1) return { named: items, rest: [] }
  return { named: items.slice(0, named), rest: items.slice(named) }
}

/** A composition bar's rows (`fold`), leaving out what was never flown. */
export function composition(
  tally: SiteCount[],
  named: number,
): { named: SiteCount[]; rest: SiteCount[]; restFlights: number } {
  const cut = fold(
    tally.filter((item) => item.flights > 0),
    named,
  )
  return {
    ...cut,
    restFlights: cut.rest.reduce((sum, item) => sum + item.flights, 0),
  }
}

/* Map geometry ------------------------------------------------------------
   Everything the map decides once the projection has turned places into
   points: plane geometry in the SVG's own pixels, so it can be tested
   without a projection or a DOM. */

export type Point = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }

/** An airport's dot, by traffic: a hub reads bigger without drowning the rest. */
export const dotRadius = (visits: number) =>
  1.8 + Math.sqrt(Math.min(visits, 25)) * 0.75

/**
 * The control point of a route's curve: a quadratic from one end to the
 * other, bowed `lift` of its length off the chord, always toward the top
 * of the map so crossing routes read as a family rather than a tangle.
 */
export function bow(a: Point, b: Point, lift = 0.22): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  // A normal to the chord, turned to point up the map.
  const [nx, ny] = dx >= 0 ? [dy, -dx] : [-dy, dx]
  return { x: (a.x + b.x) / 2 + nx * lift, y: (a.y + b.y) / 2 + ny * lift }
}

/** Groups points that sit within `within` of another in the group. */
export function clusters<T extends Point>(points: T[], within: number): T[][] {
  const groups: T[][] = []
  for (const point of points) {
    const near = groups.filter((group) =>
      group.some((q) => Math.hypot(q.x - point.x, q.y - point.y) < within),
    )
    const merged = [...near.flat(), point]
    for (const group of near) groups.splice(groups.indexOf(group), 1)
    groups.push(merged)
  }
  return groups
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h

export type LabelSpec = Point & {
  key: string
  /** The dot's radius, so a label clears it. */
  r: number
  w: number
  h: number
}

export type Placed = Box & { align: "start" | "middle" | "end" }

/**
 * Where each label goes: tried in the order given (so busiest first) on
 * the right of its dot, then the left, above, below and the four
 * diagonals, taking the first spot that stays inside `bounds` and clear
 * of every dot, every obstacle and every label already placed. A label
 * with no such spot is left out, not drawn over another.
 */
export function placeLabels(
  specs: LabelSpec[],
  obstacles: Box[],
  bounds: Box,
  gap = 3,
): Map<string, Placed> {
  const dots = specs.map(({ x, y, r }) => ({
    x: x - r,
    y: y - r,
    w: 2 * r,
    h: 2 * r,
  }))
  const taken: Box[] = []
  const placed = new Map<string, Placed>()
  for (const { key, x, y, r, w, h } of specs) {
    const d = r + gap
    const candidates: Placed[] = [
      { x: x + d, y: y - h / 2, w, h, align: "start" },
      { x: x - d - w, y: y - h / 2, w, h, align: "end" },
      { x: x - w / 2, y: y - d - h, w, h, align: "middle" },
      { x: x - w / 2, y: y + d, w, h, align: "middle" },
      { x: x + d * 0.7, y: y - d * 0.7 - h, w, h, align: "start" },
      { x: x - d * 0.7 - w, y: y - d * 0.7 - h, w, h, align: "end" },
      { x: x + d * 0.7, y: y + d * 0.7, w, h, align: "start" },
      { x: x - d * 0.7 - w, y: y + d * 0.7, w, h, align: "end" },
    ]
    const spot = candidates.find(
      (box) =>
        contains(bounds, box) &&
        ![...dots, ...obstacles, ...taken].some((other) =>
          overlaps(box, other),
        ),
    )
    if (!spot) continue
    taken.push(spot)
    placed.set(key, spot)
  }
  return placed
}

/**
 * The centre for a circle of `radius` in whichever corner of the map is
 * farthest from everything drawn on it (`points`, sampled along routes
 * as well as airports), `margin` in from the edges.
 */
export function emptiestCorner(
  width: number,
  height: number,
  radius: number,
  margin: number,
  points: Point[],
): Point {
  const near = radius + margin
  const corners: Point[] = [
    { x: width - near, y: height - near },
    { x: near, y: height - near },
    { x: width - near, y: near },
    { x: near, y: near },
  ]
  const clearance = (c: Point) =>
    Math.min(...points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))
  return corners.reduce((best, c) =>
    clearance(c) > clearance(best) ? c : best,
  )
}

export const loadSite = (
  endpoint: string,
  onData: (site: Site) => void,
): Promise<void> =>
  swr(
    `flights:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => miscSection(endpoint, "flights") as Promise<Site>,
    isSite,
    onData,
  )
