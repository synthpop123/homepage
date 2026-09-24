import { describe, expect, it } from "bun:test"
import {
  arcPoint,
  formatDuration,
  homeView,
  isSite,
  midpoint,
  project,
  routeId,
  routeLabel,
  routesAt,
  SITE_SCHEMA_VERSION,
  type Site,
  share,
  statCards,
  surfacePoint,
  toVector,
  viewAngles,
} from "./flights"
import fixture from "./flights.site-fixture.json"

const site = fixture as Site

describe("isSite", () => {
  it("accepts the pinned fixture", () => {
    expect(isSite(fixture)).toBe(true)
    expect(fixture.schemaVersion).toBe(SITE_SCHEMA_VERSION)
  })

  it("rejects another schema version", () => {
    expect(isSite({ ...fixture, schemaVersion: SITE_SCHEMA_VERSION + 1 })).toBe(
      false,
    )
  })

  it("rejects a route whose airport the payload doesn't list", () => {
    const [first, ...rest] = site.routes
    expect(
      isSite({ ...site, routes: [{ ...first, to: "XXX" }, ...rest] }),
    ).toBe(false)
  })

  it("rejects a route missing a field the renderer reads", () => {
    const { km: _, ...first } = site.routes[0]
    expect(isSite({ ...site, routes: [first] })).toBe(false)
  })

  it("rejects an airport off the globe", () => {
    const [first, ...rest] = site.airports
    expect(
      isSite({ ...site, airports: [{ ...first, lat: 91 }, ...rest] }),
    ).toBe(false)
  })
})

describe("statCards", () => {
  const route = { upcoming: 0, minutes: null }
  const sample: Site = {
    ...site,
    stats: {
      ...site.stats,
      flights: 25,
      km: 34_511,
      minutes: 3937,
      airports: 15,
      countries: 1,
      routes: 3,
      airlines: 2,
      aircraftTypes: 2,
      firstDate: "2023-08-02",
    },
    routes: [
      { ...route, from: "PEK", to: "SHA", flights: 6, km: 1076 },
      { ...route, from: "CAN", to: "HKT", flights: 2, km: 2332 },
      { ...route, from: "GMP", to: "PUS", flights: 1, km: 327 },
      { ...route, from: "PEK", to: "SIN", flights: 0, upcoming: 1, km: 4480 },
    ],
    airlines: [
      { code: "CA", name: "Air China", flights: 9 },
      { code: "CZ", name: "China Southern", flights: 5 },
    ],
    aircraft: [
      { code: "A21N", name: "Airbus A321neo", flights: 4 },
      { code: "A20N", name: "Airbus A320neo", flights: 4 },
    ],
  }

  it("fills eight cells with a foot line each", () => {
    expect(statCards(sample).map((card) => [card.value, card.foot])).toEqual([
      ["25", "since 2023"],
      ["34,511 km", "0.86× around the Earth"],
      ["65h 37m", "≈ 2.7 days aloft"],
      ["15", "in 1 country"],
      ["3", "PEK ⇄ SHA ×6"],
      // An upcoming route is not the longest flown, however far it goes.
      ["2,332 km", "CAN ⇄ HKT"],
      ["2", "mostly Air China"],
      // A tie at the top names nobody.
      ["2", ""],
    ])
  })

  it("names no busiest route when every route was flown once", () => {
    const once = sample.routes.map((r) => ({ ...r, flights: 1 }))
    expect(statCards({ ...sample, routes: once })[4].foot).toBe("")
  })

  it("keeps the fixture's cards filled", () => {
    for (const card of statCards(site)) expect(card.value).not.toBe("")
  })
})

describe("formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45m")
    expect(formatDuration(120)).toBe("2h")
    expect(formatDuration(135)).toBe("2h 15m")
  })

  it("labels a route either way and ranks rows against the leader", () => {
    expect(routeLabel({ from: "PEK", to: "SHA" })).toBe("PEK ⇄ SHA")
    expect(share(3, 6)).toBe(0.5)
    expect(share(3, 0)).toBe(0)
  })
})

describe("globe geometry", () => {
  it("finds the great-circle midpoint", () => {
    const [lat, lon] = midpoint([0, 0], [0, 90])
    expect(lat).toBeCloseTo(0)
    expect(lon).toBeCloseTo(45)
  })

  it("weights the home view toward the busy airports", () => {
    const [lat, lon] = homeView(site.airports)
    expect(lat).toBeGreaterThan(20)
    expect(lat).toBeLessThan(40)
    expect(lon).toBeGreaterThan(105)
    expect(lon).toBeLessThan(125)
  })

  it("unwraps phi onto the nearest turn", () => {
    const { phi } = viewAngles([30, 120])
    const near = viewAngles([30, 120], phi + 4 * Math.PI + 0.1)
    expect(near.phi - phi).toBeCloseTo(4 * Math.PI)
  })

  it("keys a route the same either way round", () => {
    expect(routeId("SHA", "PEK")).toBe(routeId("PEK", "SHA"))
    const hub = site.airports[0]
    const touching = routesAt(site, hub.code)
    expect(touching.length).toBeGreaterThan(0)
    expect(
      touching.every((r) => r.from === hub.code || r.to === hub.code),
    ).toBe(true)
  })

  // The overlay only lines up with the canvas if these agree with cobe:
  // turning to a place has to bring it to the centre, facing out.
  it("projects a place it turned to onto the centre", () => {
    for (const place of [
      [39.9, 116.4],
      [1.35, 103.8],
      [-33.9, 151.2],
    ] as [number, number][]) {
      const view = { ...viewAngles(place), scale: 1 }
      const { x, y, visible } = project(surfacePoint(place, 0), view)
      expect(x).toBeCloseTo(0.5)
      expect(y).toBeCloseTo(0.5)
      expect(visible).toBe(true)
    }
  })

  it("hides the far side, but not what rises past the disc", () => {
    const view = { ...viewAngles([0, 0]), scale: 1 }
    expect(project(surfacePoint([0, 180], 0), view).visible).toBe(false)
    expect(project(surfacePoint([0, 90], 0.2), view).visible).toBe(true)
  })

  it("runs an arc from one end to the other, lifted between", () => {
    const a = toVector([39.9, 116.4])
    const b = toVector([31.2, 121.3])
    const start = arcPoint(a, b, 0, 0.1, 0.01)
    const end = arcPoint(a, b, 1, 0.1, 0.01)
    start.forEach((v, i) => expect(v).toBeCloseTo(a[i] * 0.81))
    end.forEach((v, i) => expect(v).toBeCloseTo(b[i] * 0.81))
    expect(Math.hypot(...arcPoint(a, b, 0.5, 0.1, 0.01))).toBeGreaterThan(0.81)
  })
})
