/**
 * Writes the two base maps the Flights section draws under its routes, as
 * TopoJSON with one `countries` object each (land is their union, borders
 * the arcs two of them share):
 *
 * - `asia-50m.json` — Natural Earth's 1:50m countries cut to CLIP, a margin
 *   round REGION, the part of the world every flight so far has stayed
 *   inside. The runtime falls back to the world map before the cut edges
 *   could come into view, so they never read as coastline.
 * - `world-110m.json` — the whole world at 1:110m, loaded only when a map
 *   would show something outside REGION.
 *
 * Run with `bun scripts/flights-basemap.ts` after changing REGION. Both
 * files are committed, so a build never needs `world-atlas`.
 */

import { feature } from "topojson-client"
import { topology } from "topojson-server"
import type { GeometryCollection, Topology } from "topojson-specification"
import countries50 from "world-atlas/countries-50m.json"
import countries110 from "world-atlas/countries-110m.json"

/** [[west, south], [east, north]], degrees. Mirrored into the file. */
const REGION: [[number, number], [number, number]] = [
  [60, -12],
  [150, 56],
]
/** REGION plus a margin, in the same form. */
const CLIP: [[number, number], [number, number]] = [
  [REGION[0][0] - 20, REGION[0][1] - 15],
  [REGION[1][0] + 20, REGION[1][1] + 6],
]
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

const clipPolygon = (rings: Ring[]) => {
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

const write = async (name: string, features: GeoJSON.Feature[], extra = {}) => {
  const countries: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  }
  const topo = topology({ countries }, 1e4)
  const body = JSON.stringify({ ...topo, ...extra })
  await Bun.write(new URL(name, OUT), body)
  console.log(`${name}: ${features.length} countries, ${body.length} bytes`)
}

await write(
  "asia-50m.json",
  shapes(countries50)
    .map(clip)
    .filter((c): c is GeoJSON.Feature => c !== null),
  {
    region: REGION,
  },
)
await write("world-110m.json", shapes(countries110))
