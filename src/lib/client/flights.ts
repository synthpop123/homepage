/**
 * Data layer for the Flights section: types for cf-workers-api's
 * /flights/site view (see src/services/flights/compose.ts there), delivered
 * in the /misc bundle, the payload decoder, and every
 * render decision that isn't DOM — the stat cards, the ranked lists, the
 * arcs and markers the globe draws, and the angles it turns to. Pure and
 * browser-safe.
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

/** `mostly Air China`, unless the top of the tally is a tie. */
const lead = (tally: SiteCount[]) => {
  const [first, second] = tally
  if (!first || (second && second.flights === first.flights)) return ""
  return `mostly ${first.name}`
}

/**
 * The eight readout cells, in order: four totals, then what they were
 * made of — the routes, the longest of them, the airlines and the
 * aircraft, each footed by the one that leads it.
 */
export function statCards(site: Site): StatCard[] {
  const { stats } = site
  const laps = stats.km / EARTH_KM
  const days = stats.minutes / (60 * 24)
  const flown = site.routes.filter((route) => route.flights > 0)
  const busiest = flown[0]
  const longest = flown.reduce<SiteRoute | undefined>(
    (best, route) => (!best || route.km > best.km ? route : best),
    undefined,
  )
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
    {
      key: "routes",
      label: "Routes",
      value: numberFormatter.format(stats.routes),
      foot:
        busiest && busiest.flights > 1
          ? `${routeLabel(busiest)} ×${busiest.flights}`
          : "",
    },
    {
      key: "longest",
      label: "Longest",
      value: longest ? formatKm(longest.km) : "—",
      foot: longest ? routeLabel(longest) : "",
    },
    {
      key: "airlines",
      label: "Airlines",
      value: numberFormatter.format(stats.airlines),
      foot: lead(site.airlines),
    },
    {
      key: "aircraft",
      label: "Aircraft",
      value: numberFormatter.format(stats.aircraftTypes),
      foot: lead(site.aircraft),
    },
  ]
}

/** A ranked row's bar: its share of the list's leader. */
export const share = (value: number, top: number) =>
  top > 0 ? Math.min(value / top, 1) : 0

/* Globe geometry --------------------------------------------------------- */

export type LatLon = [number, number]

const rad = Math.PI / 180

/** Great-circle midpoint — where the globe turns to show a route. */
export function midpoint(a: LatLon, b: LatLon): LatLon {
  const vec = ([lat, lon]: LatLon) => [
    Math.cos(lat * rad) * Math.cos(lon * rad),
    Math.cos(lat * rad) * Math.sin(lon * rad),
    Math.sin(lat * rad),
  ]
  return centroid([vec(a), vec(b)])
}

const centroid = (vectors: number[][]): LatLon => {
  const [x, y, z] = vectors.reduce(
    (sum, v) => [sum[0] + v[0], sum[1] + v[1], sum[2] + v[2]],
    [0, 0, 0],
  )
  const len = Math.hypot(x, y, z) || 1
  return [Math.asin(z / len) / rad, Math.atan2(y, x) / rad]
}

/** The visit-weighted centre of every airport — the globe's home view. */
export function homeView(airports: SiteAirport[]): LatLon {
  if (airports.length === 0) return [30, 115]
  return centroid(
    airports.map(({ lat, lon, visits }) => {
      const w = Math.max(visits, 1)
      return [
        w * Math.cos(lat * rad) * Math.cos(lon * rad),
        w * Math.cos(lat * rad) * Math.sin(lon * rad),
        w * Math.sin(lat * rad),
      ]
    }),
  )
}

/**
 * cobe's rotation for a point to face the viewer: `phi` spins the globe
 * about its axis, `theta` tips it toward the pole. `near` unwraps `phi`
 * onto the turn closest to the current one, so easing between two views
 * never takes the long way round the planet.
 */
export function viewAngles(
  [lat, lon]: LatLon,
  near = 0,
): { phi: number; theta: number } {
  const phi = Math.PI - (lon * rad - Math.PI / 2)
  const turn = 2 * Math.PI
  return {
    phi: phi + turn * Math.round((near - phi) / turn),
    theta: lat * rad,
  }
}

/* The overlay's projection -------------------------------------------------
   The globe is cobe's, but the flight being shown — its trail, the plane on
   it, the codes at its ends — is drawn in SVG and HTML over the canvas, so
   it can animate and carry text. These functions are cobe 2's own vertex
   math (its `U`, the arc shader's quadratic curve, and the projection it
   places anchors with), so what is drawn over the globe lands on the arc
   the globe drew. */

export type Vec3 = [number, number, number]

/** cobe's globe radius in clip space, before `scale`. */
const RADIUS = 0.8

/** A location as cobe's unit vector (y up, the globe's own axes). */
export function toVector([lat, lon]: LatLon): Vec3 {
  const r = lat * rad
  const a = lon * rad - Math.PI
  return [-Math.cos(r) * Math.cos(a), Math.sin(r), Math.cos(r) * Math.sin(a)]
}

/**
 * The point `t` (0–1) of the way along cobe's arc between two locations:
 * a quadratic curve from one marker to the other, bent through a control
 * point `height` above the midpoint of the two directions.
 */
export function arcPoint(
  from: Vec3,
  to: Vec3,
  t: number,
  height: number,
  elevation: number,
): Vec3 {
  const ends = RADIUS + elevation
  const sum = from.map((v, i) => v + to[i])
  const length = Math.hypot(...sum)
  const lift = RADIUS + height + elevation
  const control =
    length > 1e-3 ? sum.map((v) => (v / length) * lift) : [0, lift, 0]
  const u = 1 - t
  return from.map(
    (v, i) => u * u * v * ends + 2 * u * t * control[i] + t * t * to[i] * ends,
  ) as Vec3
}

/** A point on (or above) the surface, lifted by `elevation`. */
export const surfacePoint = (location: LatLon, elevation: number): Vec3 =>
  toVector(location).map((v) => v * (RADIUS + elevation)) as Vec3

/**
 * Where cobe draws a 3D point, as fractions of the canvas's width and
 * height (`aspect` is width over height), and whether it is in front:
 * behind the globe counts as hidden only where the globe's disc covers it,
 * the same test cobe's arc shader discards fragments by.
 */
export function project(
  point: Vec3,
  view: { phi: number; theta: number; scale: number; aspect?: number },
): { x: number; y: number; visible: boolean } {
  const [px, py, pz] = point
  const cp = Math.cos(view.phi)
  const sp = Math.sin(view.phi)
  const ct = Math.cos(view.theta)
  const st = Math.sin(view.theta)
  const x = cp * px + sp * pz
  const y = sp * st * px + ct * py - cp * st * pz
  const z = -sp * ct * px + st * py + cp * ct * pz
  return {
    x: ((x / (view.aspect ?? 1)) * view.scale + 1) / 2,
    y: (-y * view.scale + 1) / 2,
    visible: z >= 0 || x * x + y * y >= RADIUS * RADIUS,
  }
}

/** A route's key, whichever way round its ends are given. */
export const routeId = (a: string, b: string) => [a, b].sort().join("-")

/** The routes an airport is an end of. */
export const routesAt = (site: Site, code: string) =>
  site.routes.filter((route) => route.from === code || route.to === code)

/** Marker radius by traffic: a hub reads bigger without drowning the rest. */
export const markerSize = (visits: number) =>
  0.009 + Math.min(Math.sqrt(visits), 4) * 0.005

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
