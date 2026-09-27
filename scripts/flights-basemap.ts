/**
 * Writes the two base maps the Flights section draws under its routes, as
 * TopoJSON with one `countries` object each (land is their union, borders
 * the arcs two of them share):
 *
 * - `asia.json` — Natural Earth's 1:50m countries cut to CLIP, a margin
 *   round REGION, simplified to what the map can draw. REGION holds every
 *   frame the section has drawn so far, at every width, so this is the
 *   only file a visit fetches. The runtime falls back to the world map
 *   before the cut edges could come into view, so they never read as
 *   coastline.
 * - `world-110m.json` — the whole world at 1:110m, loaded only when a map
 *   would show something outside REGION.
 *
 * The map is at most ~700px across some 90° of longitude, about 8px a
 * degree, where 1:50m carries detail no pixel can show. The one place
 * drawn closer is the inset round a knot of airports, at about six times
 * that, so coastline within DETAIL of an airport the section has flown to
 * keeps every point. Everything else loses the points that shape less
 * than MIN_AREA, and islands smaller than it go.
 *
 * Run with `bun scripts/flights-basemap.ts` after changing REGION, or
 * when a flight lands somewhere new. Both files are committed, so a build
 * never needs `world-atlas`.
 */

import { feature, quantize } from "topojson-client"
import { topology } from "topojson-server"
import { filter, filterWeight, presimplify, simplify } from "topojson-simplify"
import type {
  GeometryCollection,
  Objects,
  Topology,
} from "topojson-specification"
import countries50 from "world-atlas/countries-50m.json"
import countries110 from "world-atlas/countries-110m.json"
import site from "../src/lib/client/flights.site-fixture.json"

/** [[west, south], [east, north]], degrees. Mirrored into the file. */
const REGION: [[number, number], [number, number]] = [
  [56, -14],
  [166, 58],
]
/** REGION plus a margin, in the same form, short of the antimeridian. */
const CLIP: [[number, number], [number, number]] = [
  [REGION[0][0] - 12, REGION[0][1] - 10],
  [Math.min(REGION[1][0] + 12, 180), REGION[1][1] + 6],
]
/** Smallest triangle a kept point may span, and island a kept ring may
 *  enclose, in square degrees: about a pixel at the map's widest. */
const MIN_AREA = 0.01
/** How far round an airport the coast keeps full detail, in degrees. */
const DETAIL = 1.5
/** Grid the coordinates snap to, this many steps across CLIP: about a
 *  sixth of a pixel on the map, a pixel in the inset. */
const QUANTIZE = 5e3
const OUT = new URL("../src/assets/flights/", import.meta.url)

const shapes = (source: unknown) => {
  const topo = source as Topology<{ countries: GeometryCollection }>
  return feature(topo, topo.objects.countries).features.map((country) => ({
    type: "Feature" as const,
    properties: {},
    geometry: country.geometry,
  }))
}

type Ring = GeoJSON.Position[]

/** Sutherland–Hodgman against one edge of CLIP, planar in degrees. */
const clipEdge = (
  ring: Ring,
  inside: (p: GeoJSON.Position) => boolean,
  cross: (a: GeoJSON.Position, b: GeoJSON.Position) => GeoJSON.Position,
): Ring => {
  const out: Ring = []
  ring.forEach((point, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length]
    if (inside(point)) {
      if (!inside(prev)) out.push(cross(prev, point))
      out.push(point)
    } else if (inside(prev)) out.push(cross(prev, point))
  })
  return out
}

const at = (a: GeoJSON.Position, b: GeoJSON.Position, t: number) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
]

const clipRing = (closed: Ring): Ring | null => {
  const [[w, s], [e, n]] = CLIP
  let ring = closed.slice(0, -1)
  const x = (v: number) => (a: GeoJSON.Position, b: GeoJSON.Position) =>
    at(a, b, (v - a[0]) / (b[0] - a[0]))
  const y = (v: number) => (a: GeoJSON.Position, b: GeoJSON.Position) =>
    at(a, b, (v - a[1]) / (b[1] - a[1]))
  ring = clipEdge(ring, (p) => p[0] >= w, x(w))
  ring = clipEdge(ring, (p) => p[0] <= e, x(e))
  ring = clipEdge(ring, (p) => p[1] >= s, y(s))
  ring = clipEdge(ring, (p) => p[1] <= n, y(n))
  return ring.length >= 3 ? [...ring, ring[0]] : null
}

/**
 * A few rings (Fiji's) run to both +180 and -180 and close along the
 * antimeridian. A planar cut turns one into a sliver across the whole
 * of CLIP, wound the wrong way, which d3 then fills as the rest of the
 * globe: the sea painted as land. None is anywhere near REGION.
 */
const wraps = (ring: Ring) =>
  Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0])) > 180

const clipPolygon = (rings: Ring[]) => {
  if (rings.some(wraps)) return null
  const [outer, ...holes] = rings.map(clipRing)
  return outer ? [outer, ...holes.filter((h): h is Ring => h !== null)] : null
}

/**
 * A country cut to CLIP, or null when nothing of it is left. Natural Earth
 * splits every ring at the antimeridian, so no ring jumps across it and a
 * planar cut in degrees is safe.
 */
const clip = (country: GeoJSON.Feature): GeoJSON.Feature | null => {
  const geometry = country.geometry
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : []
  const kept = polygons.map(clipPolygon).filter((p): p is Ring[] => p !== null)
  if (kept.length === 0) return null
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "MultiPolygon", coordinates: kept },
  }
}

const airports = site.airports.map((a) => [a.lon, a.lat])
const nearAirport = ([lon, lat]: number[]) =>
  airports.some(
    ([x, y]) => Math.abs(lon - x) < DETAIL && Math.abs(lat - y) < DETAIL,
  )

/**
 * Drops what the map cannot draw: points spanning less than MIN_AREA
 * (Visvalingam), unless they lie near an airport, then rings enclosing
 * less than it. presimplify stores each point's area as its third
 * coordinate, so raising it to Infinity is how a point is kept.
 */
/** The plain topology topojson-simplify types its arguments as. */
type Plain = Topology<Objects<{}>>

const slim = (topo: Plain) => {
  const weighted = presimplify(topo)
  for (const arc of weighted.arcs)
    for (const point of arc) if (nearAirport(point)) point[2] = Infinity
  const simple = simplify(weighted, MIN_AREA)
  return filter(simple, filterWeight(simple, MIN_AREA))
}

const write = async (
  name: string,
  features: GeoJSON.Feature[],
  {
    region,
    slimmed = false,
  }: { region?: typeof REGION; slimmed?: boolean } = {},
) => {
  const countries: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  }
  let topo: Plain
  if (slimmed) {
    topo = slim(topology({ countries }) as Plain)
    // simplify leaves each point's weight behind as a third coordinate.
    for (const arc of topo.arcs) for (const point of arc) point.length = 2
    topo = quantize(topo, QUANTIZE)
  } else topo = topology({ countries }, 1e4) as Plain
  const body = JSON.stringify({ ...topo, ...(region ? { region } : {}) })
  await Bun.write(new URL(name, OUT), body)
  const gzip = Bun.gzipSync(body).length
  console.log(
    `${name}: ${features.length} countries, ${body.length} bytes, ${gzip} gzipped`,
  )
}

await write(
  "asia.json",
  shapes(countries50)
    .map(clip)
    .filter((c): c is GeoJSON.Feature => c !== null),
  { region: REGION, slimmed: true },
)
await write("world-110m.json", shapes(countries110))
