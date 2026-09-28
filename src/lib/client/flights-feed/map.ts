/**
 * The route map: a flat map framed to wherever the flights went, every
 * route a curve on it, every airport a dot. Drawn in SVG at the pixel size
 * of its box (so type stays type-sized on a phone) and redrawn when the
 * box changes width. Colours come from CSS, so a theme switch needs no JS.
 *
 * Airports that crowd one spot (four within a hundred kilometres of each
 * other in the Pearl River Delta) are drawn again, larger, in a round
 * inset in the emptiest corner, joined to a lens round the spot.
 */

import {
  type GeoPermissibleObjects,
  type GeoProjection,
  geoCentroid,
  geoConicConformal,
  geoGraticule10,
  geoMercator,
  geoPath,
} from "d3-geo"
import { feature, mesh } from "topojson-client"
import type { GeometryCollection, Topology } from "topojson-specification"
import { fetchJson } from "@/lib/client/feed"
import {
  type Box,
  bow,
  clusters,
  dotRadius,
  emptiestCorner,
  type LabelSpec,
  type Placed,
  type Point,
  placeLabels,
  type Site,
  type SiteAirport,
} from "@/lib/client/flights"

type Countries = Topology<{ countries: GeometryCollection }> & {
  /** [[west, south], [east, north]]: where the file is complete. */
  region?: [[number, number], [number, number]]
}

/** A base map, parsed once: fill, coastline and borders. */
export type BaseMap = {
  land: GeoPermissibleObjects
  coast: GeoPermissibleObjects
  borders: GeoPermissibleObjects
  region?: [[number, number], [number, number]]
}

export const toBaseMap = (topo: Countries): BaseMap => {
  const countries = topo.objects.countries
  return {
    land: feature(topo, countries),
    coast: mesh(topo, countries, (a, b) => a === b),
    borders: mesh(topo, countries, (a, b) => a !== b),
    region: topo.region,
  }
}

const NS = "http://www.w3.org/2000/svg"

/** Ids for the insets' clip paths, unique on the page. */
let insets = 0
const svg = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
) => {
  const node = document.createElementNS(NS, tag)
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value))
  parent?.append(node)
  return node
}

const round = (n: number) => Math.round(n * 10) / 10
const lonLat = (airport: SiteAirport): [number, number] => [
  airport.lon,
  airport.lat,
]

/** The map's projection: a conformal conic across the airports' latitudes. */
function frame(site: Site, width: number, height: number): GeoProjection {
  const places: GeoPermissibleObjects = {
    type: "MultiPoint",
    coordinates: site.airports.map(lonLat),
  }
  const [lon] = geoCentroid(places)
  const lats = site.airports.map((a) => a.lat)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const middle = (south + north) / 2
  const spread = Math.max((north - south) / 3, 5)
  const pad = Math.min(width, height) * 0.1
  return geoConicConformal()
    .rotate([-lon, 0])
    .parallels([middle - spread, middle + spread])
    .fitExtent(
      [
        [pad, pad],
        [width - pad, height - pad],
      ],
      places,
    )
}

/** Whether everything the frame shows lies inside the base map's region. */
function covers(map: BaseMap, projection: GeoProjection, w: number, h: number) {
  if (!map.region) return true
  const [[west, south], [east, north]] = map.region
  const edge = [0, 0.5, 1].flatMap((u) =>
    [0, 0.5, 1].map((v) => projection.invert?.([u * w, v * h])),
  )
  return edge.every(
    (at) =>
      at !== null &&
      at !== undefined &&
      at[0] >= west &&
      at[0] <= east &&
      at[1] >= south &&
      at[1] <= north,
  )
}

/** Width of label text, measured in the fonts the SVG will draw it in. */
function measurer(root: Element) {
  const context = document.createElement("canvas").getContext("2d")
  const style = getComputedStyle(root)
  const mono = style.getPropertyValue("--font-mono") || "monospace"
  const sans = style.getPropertyValue("--font-sans") || "sans-serif"
  return (text: string, kind: "code" | "city") => {
    if (!context) return text.length * 6.5
    context.font = kind === "code" ? `500 10.5px ${mono}` : `400 10px ${sans}`
    return context.measureText(text).width
  }
}

/** One label: the codes of the airports it names, and their city. */
type Group = Point & {
  key: string
  codes: string[]
  city: string
  r: number
  visits: number
}

/** Airports of one city close enough to share a label (PEK and PKX). */
function groups(
  site: Site,
  at: (airport: SiteAirport) => Point,
  within: number,
): Group[] {
  const byCity = new Map<string, (Point & { airport: SiteAirport })[]>()
  for (const airport of site.airports) {
    const city = airport.city ?? airport.code
    byCity.set(city, [...(byCity.get(city) ?? []), { ...at(airport), airport }])
  }
  return [...byCity.entries()].flatMap(([city, points]) =>
    clusters(points, within).map((members) => {
      const lead = members.reduce((a, b) =>
        b.airport.visits > a.airport.visits ? b : a,
      )
      return {
        key: members.map((m) => m.airport.code).join("-"),
        codes: members.map((m) => m.airport.code),
        city,
        x: lead.x,
        y: lead.y,
        r: dotRadius(lead.airport.visits),
        visits: members.reduce((sum, m) => sum + m.airport.visits, 0),
      }
    }),
  )
}

/** A label's height: the code alone, and the code over its city. */
const CODE_HEIGHT = 11
const FULL_HEIGHT = 21

/** Draws each placed label as the code over its city. */
function drawLabels(
  parent: Element,
  list: Group[],
  placed: Map<string, Placed>,
  labels: Map<string, SVGTextElement>,
) {
  for (const group of list) {
    const box = placed.get(group.key)
    if (!box) continue
    const x =
      box.align === "start"
        ? box.x
        : box.align === "end"
          ? box.x + box.w
          : box.x + box.w / 2
    const text = svg(
      "text",
      {
        class: "label",
        x: round(x),
        y: round(box.y + 9),
        "text-anchor": box.align,
      },
      parent,
    )
    text.append(group.codes.join(" · "))
    // A label placed without its city (see `label`) is one line high.
    if (box.h > CODE_HEIGHT)
      svg("tspan", { class: "city", x: round(x), dy: 11 }, text).textContent =
        group.city
    for (const code of group.codes) labels.set(code, text)
  }
}

export type RouteMap = {
  /**
   * Draws `site` at the box's current size, on the regional base map when
   * it covers the frame and the world map when it doesn't. A no-op when
   * neither the payload nor the size has changed since the last draw.
   */
  draw(site: Site): Promise<void>
  select(index: number | null, animate: boolean): void
}

/**
 * A base map, fetched once and shared by every draw — until it fails:
 * a rejected load is forgotten, so the next draw (a resize, a payload,
 * the network coming back) asks again instead of reusing the failure.
 */
const baseMap = (url: string) => {
  let pending: Promise<BaseMap> | undefined
  return () =>
    (pending ??= fetchJson<Countries>(url, 15_000)
      .then(toBaseMap)
      .catch((error) => {
        pending = undefined
        throw error
      }))
}

export function createRouteMap(
  root: HTMLElement,
  urls: { region: string; world: string },
  onPick: (index: number) => void,
): RouteMap {
  // The regional map is wanted on every visit, so it leaves now, beside
  // the payload; the world map only when a frame reaches past it.
  const region = baseMap(urls.region)
  const world = baseMap(urls.world)
  region().catch(() => {})
  let drawn: { site: Site; key: string } | undefined
  let pending = 0
  let selected: number | null = null
  let arcs: SVGPathElement[] = []
  const dots = new Map<string, SVGCircleElement[]>()
  const labels = new Map<string, SVGTextElement>()
  let routes: Site["routes"] = []
  const measure = measurer(root)

  const draw = async (site: Site) => {
    const width = Math.round(root.clientWidth)
    const height = Math.round(root.clientHeight)
    const key = `${width}x${height}`
    if (width === 0 || (drawn?.site === site && drawn.key === key)) return
    const ticket = ++pending
    const projection = frame(site, width, height)
    let base = await region()
    if (!covers(base, projection, width, height)) base = await world()
    // A later draw (a resize, a newer payload) has taken over.
    if (ticket !== pending) return
    drawn = { site, key }
    routes = site.routes
    dots.clear()
    labels.clear()

    projection.clipExtent([
      [-2, -2],
      [width + 2, height + 2],
    ])
    const path = geoPath(projection)
    const at = (airport: SiteAirport): Point => {
      const [x, y] = projection(lonLat(airport)) ?? [0, 0]
      return { x, y }
    }
    const byCode = new Map(site.airports.map((a) => [a.code, a]))

    const sheet = svg("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      "aria-hidden": "true",
    })
    svg("path", { class: "graticule", d: path(geoGraticule10()) ?? "" }, sheet)
    svg("path", { class: "land", d: path(base.land) ?? "" }, sheet)
    svg("path", { class: "coast", d: path(base.coast) ?? "" }, sheet)
    svg("path", { class: "borders", d: path(base.borders) ?? "" }, sheet)

    // Routes, and a wide invisible stroke over each to point at.
    const arcLayer = svg("g", { class: "arcs" }, sheet)
    const hitLayer = svg("g", { class: "hits" }, sheet)
    const samples: Point[] = []
    arcs = routes.map((route, index) => {
      const a = at(byCode.get(route.from)!)
      const b = at(byCode.get(route.to)!)
      const c = bow(a, b)
      for (const t of [0.25, 0.5, 0.75]) {
        const u = 1 - t
        samples.push({
          x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
          y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        })
      }
      const d = `M${round(a.x)} ${round(a.y)}Q${round(c.x)} ${round(c.y)} ${round(b.x)} ${round(b.y)}`
      const arc = svg(
        "path",
        {
          class: "arc",
          d,
          "stroke-width": round(0.9 + Math.sqrt(route.flights) * 0.9),
        },
        arcLayer,
      )
      if (route.flights === 0) arc.dataset.upcoming = ""
      const hit = svg("path", { class: "hit", d }, hitLayer)
      hit.addEventListener("pointerover", () => onPick(index))
      hit.addEventListener("click", () => onPick(index))
      return arc
    })

    // Airports of one city share a label; a knot of three or more
    // labels too close to tell apart goes into the inset.
    const all = groups(site, at, 12)
    const knot = clusters(all, 20)
      .filter((c) => c.length >= 3)
      .sort((a, b) => b.length - a.length)[0]
    const loose = all.filter((g) => !knot?.includes(g))

    const dotLayer = svg("g", { class: "dots" }, sheet)
    const addDot = (parent: Element, code: string, p: Point, r: number) => {
      const dot = svg(
        "circle",
        { class: "dot", cx: round(p.x), cy: round(p.y), r: round(r) },
        parent,
      )
      dots.set(code, [...(dots.get(code) ?? []), dot])
    }
    for (const airport of site.airports) {
      const inKnot = knot?.some((g) => g.codes.includes(airport.code))
      addDot(
        dotLayer,
        airport.code,
        at(airport),
        inKnot ? 1.4 : dotRadius(airport.visits),
      )
    }

    const obstacles: Box[] = []
    const labelLayer = svg("g", { class: "labels" }, sheet)
    if (knot) {
      const members = knot.flatMap((g) => g.codes.map((c) => byCode.get(c)!))
      const centre = {
        x: knot.reduce((s, g) => s + g.x, 0) / knot.length,
        y: knot.reduce((s, g) => s + g.y, 0) / knot.length,
      }
      const lens =
        Math.max(
          ...knot.map((g) => Math.hypot(g.x - centre.x, g.y - centre.y)),
        ) + 7
      const R = Math.round(Math.min(Math.max(width * 0.1, 52), 72))
      const spot = emptiestCorner(width, height, R, 14, [...all, ...samples])
      obstacles.push(
        { x: spot.x - R, y: spot.y - R, w: 2 * R, h: 2 * R },
        { x: centre.x - lens, y: centre.y - lens, w: 2 * lens, h: 2 * lens },
      )
      svg(
        "circle",
        {
          class: "lens",
          cx: round(centre.x),
          cy: round(centre.y),
          r: round(lens),
        },
        sheet,
      )
      const angle = Math.atan2(spot.y - centre.y, spot.x - centre.x)
      svg(
        "path",
        {
          class: "leader",
          d: `M${round(centre.x + Math.cos(angle) * lens)} ${round(centre.y + Math.sin(angle) * lens)}L${round(spot.x - Math.cos(angle) * R)} ${round(spot.y - Math.sin(angle) * R)}`,
        },
        sheet,
      )

      const inset = svg(
        "g",
        {
          class: "inset",
          transform: `translate(${round(spot.x - R)} ${round(spot.y - R)})`,
        },
        sheet,
      )
      const clipId = `flights-inset-${++insets}`
      svg(
        "circle",
        { cx: R, cy: R, r: R },
        svg("clipPath", { id: clipId }, svg("defs", {}, inset)),
      )
      svg("circle", { class: "inset-ground", cx: R, cy: R, r: R }, inset)
      const zoom = geoMercator().fitExtent(
        [
          [R * 0.45, R * 0.5],
          [R * 1.55, R * 1.5],
        ],
        { type: "MultiPoint", coordinates: members.map(lonLat) },
      )
      zoom.clipExtent([
        [-2, -2],
        [2 * R + 2, 2 * R + 2],
      ])
      const zoomPath = geoPath(zoom)
      const inner = svg("g", { "clip-path": `url(#${clipId})` }, inset)
      svg("path", { class: "land", d: zoomPath(base.land) ?? "" }, inner)
      svg("path", { class: "coast", d: zoomPath(base.coast) ?? "" }, inner)
      const zoomAt = (airport: SiteAirport): Point => {
        const [x, y] = zoom(lonLat(airport)) ?? [0, 0]
        return { x, y }
      }
      const zoomed = groups({ ...site, airports: members }, zoomAt, 12)
      for (const airport of members)
        addDot(inner, airport.code, zoomAt(airport), dotRadius(airport.visits))
      label(inner, zoomed, [], {
        x: R * 0.2,
        y: R * 0.2,
        w: R * 1.6,
        h: R * 1.6,
      })
      svg("circle", { class: "inset-rim", cx: R, cy: R, r: R }, inset)
    }

    /**
     * Labels a set of groups, busiest first: code over city where that
     * fits, then the code alone for any left out, so a crowded spot keeps
     * its codes before it loses its cities.
     */
    function label(parent: Element, list: Group[], avoid: Box[], bounds: Box) {
      const ordered = [...list].sort((a, b) => b.visits - a.visits)
      const spec = (group: Group, city: boolean): LabelSpec => {
        const code = measure(group.codes.join(" · "), "code")
        return {
          key: group.key,
          x: group.x,
          y: group.y,
          r: group.r,
          w: city ? Math.max(code, measure(group.city, "city")) : code,
          h: city ? FULL_HEIGHT : CODE_HEIGHT,
        }
      }
      const placed = placeLabels(
        ordered.map((g) => spec(g, true)),
        avoid,
        bounds,
      )
      const dotBoxes = ordered.map(({ x, y, r }) => ({
        x: x - r,
        y: y - r,
        w: 2 * r,
        h: 2 * r,
      }))
      const rest = placeLabels(
        ordered.filter((g) => !placed.has(g.key)).map((g) => spec(g, false)),
        [...avoid, ...dotBoxes, ...placed.values()],
        bounds,
      )
      drawLabels(parent, ordered, new Map([...placed, ...rest]), labels)
    }

    label(labelLayer, loose, obstacles, {
      x: 4,
      y: 4,
      w: width - 8,
      h: height - 8,
    })

    root.replaceChildren(sheet)
    const current = selected
    selected = null
    if (current !== null) select(current, false)
  }

  const select = (index: number | null, animate: boolean) => {
    if (index === selected) return
    selected = index
    const route = index === null ? null : routes[index]
    const ends = route ? [route.from, route.to] : []
    root.toggleAttribute("data-focus", route !== null)
    arcs.forEach((arc, i) => {
      const on = i === index
      arc.toggleAttribute("data-on", on)
      if (!on) return
      // Raise it over the routes it crosses, then draw it in.
      arc.parentElement?.append(arc)
      if (!animate) return
      const length = arc.getTotalLength()
      arc.animate(
        [
          { strokeDasharray: `0 ${length}` },
          { strokeDasharray: `${length} 0` },
        ],
        { duration: 800, easing: "cubic-bezier(.3,.7,.2,1)" },
      )
    })
    for (const [code, list] of dots)
      for (const dot of list)
        dot.toggleAttribute("data-on", ends.includes(code))
    for (const [code, text] of labels)
      text.toggleAttribute("data-on", ends.includes(code))
  }

  return { draw, select }
}
