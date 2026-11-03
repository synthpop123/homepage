import { describe, expect, it } from "bun:test"
import {
  availableRanges,
  bestDay,
  change,
  formatPoints,
  formatPrice,
  formatPriceChange,
  formatReturn,
  grainFor,
  heldFor,
  holdingFacts,
  isSite,
  maxDrawdown,
  rangeCutoff,
  rangeStart,
  type Site,
  SITE_SCHEMA_VERSION,
  stripCells,
  view,
} from "./portfolio"
import fixture from "./portfolio.site-fixture.json"

const site = fixture as Site

/** Weekdays from `from`, `count` of them. */
const weekdays = (from: string, count: number) => {
  const days: string[] = []
  const date = new Date(`${from}T12:00:00Z`)
  while (days.length < count) {
    const day = date.getUTCDay()
    if (day !== 0 && day !== 6) days.push(date.toISOString().slice(0, 10))
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return days
}

describe("isSite", () => {
  it("accepts the pinned production fixture", () => {
    expect(isSite(fixture)).toBe(true)
    expect(fixture.schemaVersion).toBe(SITE_SCHEMA_VERSION)
  })

  it("rejects another schema version", () => {
    expect(isSite({ ...fixture, schemaVersion: SITE_SCHEMA_VERSION + 1 })).toBe(
      false,
    )
  })

  it("rejects a series off the axis, or with a gap after it starts", () => {
    const [first, ...rest] = site.accounts
    const short = { ...first, index: first.index.slice(1) }
    expect(isSite({ ...fixture, accounts: [short, ...rest] })).toBe(false)
    const gap = [...first.index]
    gap[5] = null
    expect(isSite({ ...fixture, accounts: [{ ...first, index: gap }] })).toBe(
      false,
    )
  })

  it("rejects an amount where a share belongs", () => {
    const [first] = site.accounts
    expect(
      isSite({
        ...fixture,
        accounts: [{ ...first, cash: [{ currency: "USD", weight: 588.18 }] }],
      }),
    ).toBe(false)
    const [holding] = first.holdings
    expect(
      isSite({
        ...fixture,
        accounts: [
          { ...first, holdings: [{ ...holding, performance: "12%" }] },
        ],
      }),
    ).toBe(false)
  })
})

describe("isSite, per position", () => {
  it("rejects a cost that is not a price, or a buy that is not a day", () => {
    const [first, ...rest] = site.accounts
    const [holding, ...others] = first.holdings
    const with_ = (patch: object) => ({
      ...fixture,
      accounts: [
        { ...first, holdings: [{ ...holding, ...patch }, ...others] },
        ...rest,
      ],
    })
    expect(isSite(with_({ cost: null, since: null }))).toBe(true)
    expect(isSite(with_({ cost: -3 }))).toBe(false)
    expect(isSite(with_({ since: "2026-02-30" }))).toBe(false)
  })

  it("rejects a country that is not a code", () => {
    const symbols = site.symbols.map((entry, i) =>
      i === 0 ? { ...entry, country: "United States" } : entry,
    )
    expect(isSite({ ...fixture, symbols })).toBe(false)
  })
})

describe("holdingFacts", () => {
  const avgo = view(site, "all", "3M").rows.find((row) => row.symbol === "AVGO")

  it("say what the company is and how the position stands against its cost", () => {
    if (!avgo) throw new Error("AVGO is in the fixture")
    const facts = holdingFacts(site, avgo)
    expect(facts?.about).toEqual(["Technology", "United States"])
    expect(facts?.site?.host).toBe("broadcom.com")
    expect(facts?.cards.map((card) => card.label)).toEqual([
      "Avg cost",
      "vs cost",
      "Last session",
      "Held",
    ])
    const band = facts?.band
    expect(band && band.price >= 0 && band.price <= 1).toBe(true)
    expect(
      band?.cost === null || (band && band.cost >= 0 && band.cost <= 1),
    ).toBe(true)
  })

  it("stretch the band to reach a cost outside the year's prices", () => {
    if (!avgo) throw new Error("AVGO is in the fixture")
    const band = holdingFacts(site, { ...avgo, cost: 1 })?.band
    expect(band?.cost).toBe(0)
    expect(band?.low).toBeGreaterThan(1)
  })

  it("name a fund a fund, and say nothing of a cost it lacks", () => {
    const boxx = view(site, "all", "3M").rows.find(
      (row) => row.symbol === "BOXX",
    )
    if (!boxx) throw new Error("BOXX is in the fixture")
    const facts = holdingFacts(site, { ...boxx, cost: null })
    expect(facts?.about[0]).toBe("ETF")
    expect(facts?.cards[0].value).toBe("—")
    expect(facts?.band?.cost).toBeNull()
  })
})

describe("heldFor", () => {
  it("counts days, then months, then years", () => {
    expect(heldFor("2026-10-20", "2026-10-21")).toBe("1 day")
    expect(heldFor("2026-10-01", "2026-10-21")).toBe("20 days")
    expect(heldFor("2026-01-28", "2026-10-21")).toBe("9 mo")
    expect(heldFor("2025-01-01", "2026-10-21")).toBe("1.8 yr")
  })
})

describe("ranges", () => {
  const days = weekdays("2025-11-24", 238)
  const last = days[days.length - 1]

  it("measures from the session on or before each cutoff", () => {
    expect(last).toBe("2026-10-21")
    expect(rangeCutoff("1W", last)).toBe("2026-10-14")
    expect(rangeCutoff("1M", last)).toBe("2026-09-21")
    expect(rangeCutoff("YTD", last)).toBe("2025-12-31")
    expect(rangeCutoff("1M", "2026-03-31")).toBe("2026-02-28")
    const full = days.map(() => 1)
    expect(days[rangeStart(days, "1W", full)]).toBe("2026-10-14")
    expect(days[rangeStart(days, "ALL", full)]).toBe("2025-11-24")
  })

  it("start where a series does when it began inside the range", () => {
    const late = days.map((_, i) => (i < 200 ? null : 1))
    expect(rangeStart(days, "3M", late)).toBe(200)
  })

  it("offer only ranges that start after the series does", () => {
    const full = days.map(() => 1)
    expect(availableRanges(days, full)).toEqual([
      "1W",
      "1M",
      "3M",
      "YTD",
      "ALL",
    ])
    const late = days.map((_, i) => (i < 220 ? null : 1))
    expect(availableRanges(days, late)).toEqual(["1W", "ALL"])
  })
})

describe("returns", () => {
  it("divide two values of the series", () => {
    expect(change([1, 1.1, 1.21], 1)).toBeCloseTo(0.1)
    expect(change([null, 2, 3], 0)).toBeNull()
  })

  it("find the deepest fall from a running peak", () => {
    expect(maxDrawdown([1, 1.2, 0.9, 1.3, 1.1], 0)).toEqual({
      depth: 0.9 / 1.2 - 1,
      peak: 1,
      trough: 2,
    })
    expect(maxDrawdown([1, 1.1, 1.2], 0)).toBeNull()
  })
})

describe("stripCells", () => {
  it("chains each cell from the previous cell's last close", () => {
    const days = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-12"]
    const cells = stripCells(days, [1, 1.1, 1.21, 1.21], 0, "week")
    expect(cells.map((cell) => [cell.from, cell.to])).toEqual([
      [1, 2],
      [3, 3],
    ])
    expect(cells[0].change).toBeCloseTo(0.21)
    expect(cells[1].change).toBe(0)
    expect(cells[1].level).toBe(0)
    expect(cells[0].level).toBeGreaterThan(0)
  })

  it("coarsens with the length of the range", () => {
    expect(grainFor(22)).toBe("day")
    expect(grainFor(200)).toBe("week")
    expect(grainFor(500)).toBe("month")
  })
})

describe("figures", () => {
  it("sign returns with a true minus and none on zero", () => {
    expect(formatReturn(0.12734)).toBe("+12.73%")
    expect(formatReturn(-0.031)).toBe("−3.10%")
    expect(formatReturn(-0.00001)).toBe("0.00%")
    expect(formatPoints(0.0321)).toBe("+3.2 pp")
  })

  it("print prices in their own currency", () => {
    expect(formatPrice(532.95, "USD")).toBe("$532.95")
    expect(formatPrice(668.5, "HKD")).toBe("HK$668.50")
    expect(formatPriceChange(-4.05, "USD")).toBe("−$4.05")
  })
})

describe("view", () => {
  it("resolves the fixture's portfolio over its default range", () => {
    const resolved = view(site, "all", "3M")
    expect(resolved.range).toBe("3M")
    expect(resolved.cards.map((card) => card.label)).toEqual([
      "Last session",
      "vs S&P 500",
      "Max drawdown",
      "Best day",
    ])
    expect(resolved.rows.length).toBe(site.accounts[0].holdings.length)
    // Rows keep the account's weight order.
    const weights = resolved.rows.map((row) => row.weight)
    expect([...weights].sort((a, b) => b - a)).toEqual(weights)
  })

  it("falls back to a range the account has", () => {
    const resolved = view(site, "all", "1Y")
    expect(resolved.ranges).not.toContain("1Y")
    expect(resolved.range).toBe("3M")
  })

  it("falls back to the whole portfolio for an unknown account", () => {
    expect(view(site, "gone", "3M").account.id).toBe("all")
  })
})

describe("bestDay", () => {
  const best = [
    { date: "2026-10-30", change: 0.01 },
    { date: "2026-09-15", change: 0.03 },
    { date: "2026-03-02", change: 0.05 },
  ]

  it("takes the earliest record after the range's start", () => {
    expect(bestDay(best, "2026-01-02")?.change).toBe(0.05)
    expect(bestDay(best, "2026-08-01")?.change).toBe(0.03)
    expect(bestDay(best, "2026-09-15")?.change).toBe(0.01)
  })

  it("is null when no day falls inside the range", () => {
    expect(bestDay(best, "2026-10-30")).toBeNull()
    expect(bestDay([], "2026-01-02")).toBeNull()
  })
})
