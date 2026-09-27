import { describe, expect, it } from "bun:test"
import {
  bow,
  clusters,
  composition,
  emptiestCorner,
  fold,
  flownRoutes,
  formatDuration,
  isSite,
  placeLabels,
  routeLabel,
  SITE_SCHEMA_VERSION,
  type Site,
  share,
  statCards,
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

  it("takes no last flight, and rejects one without a calendar day", () => {
    expect(isSite({ ...fixture, last: null })).toBe(true)
    expect(
      isSite({ ...fixture, last: { ...fixture.last, date: "Aug 16" } }),
    ).toBe(false)
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

  it("fills four cells with a foot line each", () => {
    expect(statCards(sample).map((card) => [card.value, card.foot])).toEqual([
      ["25", "since 2023"],
      ["34,511 km", "0.86× the equator"],
      ["65h 37m", "≈ 2.7 days aloft"],
      ["15", "in 1 country"],
    ])
  })

  it("ranks only routes flown at least once", () => {
    expect(flownRoutes(sample).map(routeLabel)).toEqual([
      "PEK ⇄ SHA",
      "CAN ⇄ HKT",
      "GMP ⇄ PUS",
    ])
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

describe("fold", () => {
  it("cuts after the named rows, unless only one would fold", () => {
    const items = Array.from({ length: 14 }, (_, i) => i)
    expect(fold(items, 10).rest).toEqual([10, 11, 12, 13])
    expect(fold(items.slice(0, 11), 10)).toEqual({
      named: items.slice(0, 11),
      rest: [],
    })
  })
})

describe("composition", () => {
  const tally = (...counts: number[]) =>
    counts.map((flights, i) => ({ code: null, name: `#${i}`, flights }))

  it("names the first few and folds the rest", () => {
    const { named, rest, restFlights } = composition(
      tally(9, 5, 2, 2, 2, 1, 1),
      4,
    )
    expect(named.map((item) => item.flights)).toEqual([9, 5, 2, 2])
    expect(rest).toHaveLength(3)
    expect(restFlights).toBe(4)
  })

  it("shows a rest of one rather than folding it", () => {
    const { named, rest } = composition(tally(9, 5, 2, 2, 2), 4)
    expect(named).toHaveLength(5)
    expect(rest).toEqual([])
  })

  it("leaves out what was never flown", () => {
    expect(composition(tally(3, 0), 4).named).toHaveLength(1)
  })
})

describe("map geometry", () => {
  it("bows every route toward the top of the map, whichever way it runs", () => {
    const a = { x: 0, y: 100 }
    const b = { x: 100, y: 100 }
    expect(bow(a, b).y).toBeLessThan(100)
    expect(bow(b, a).y).toBeLessThan(100)
    expect(bow(a, b)).toEqual(bow(b, a))
  })

  it("chains points into clusters", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 16, y: 0 },
      { x: 100, y: 0 },
    ]
    expect(
      clusters(points, 10)
        .map((group) => group.length)
        .sort(),
    ).toEqual([1, 3])
  })

  const bounds = { x: 0, y: 0, w: 200, h: 200 }
  const label = (key: string, x: number, y: number) => ({
    key,
    x,
    y,
    r: 3,
    w: 40,
    h: 20,
  })

  it("puts a label right of its dot when there is room", () => {
    const placed = placeLabels([label("PEK", 50, 50)], [], bounds)
    expect(placed.get("PEK")).toMatchObject({ x: 56, align: "start" })
  })

  it("turns a label away from the map's edge and from its neighbours", () => {
    const placed = placeLabels(
      [label("SIN", 190, 100), label("HKT", 100, 100), label("KUL", 147, 100)],
      [],
      bounds,
    )
    expect(placed.get("SIN")?.align).toBe("end")
    const boxes = [...placed.values()]
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1))
        expect(
          a.x < b.x + b.w &&
            b.x < a.x + a.w &&
            a.y < b.y + b.h &&
            b.y < a.y + a.h,
        ).toBe(false)
  })

  it("drops a label with nowhere to go", () => {
    const placed = placeLabels([label("PEK", 100, 100)], [bounds], bounds)
    expect(placed.size).toBe(0)
  })

  it("puts the inset in the corner farthest from everything drawn", () => {
    const busy = [
      { x: 20, y: 20 },
      { x: 180, y: 20 },
      { x: 20, y: 180 },
    ]
    expect(emptiestCorner(200, 200, 30, 10, busy)).toEqual({ x: 160, y: 160 })
  })
})
