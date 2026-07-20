/**
 * Tests for the pure data layer behind the Tokens dashboard. The
 * date, aggregation and streak logic here is what the dashboard
 * renders from, so boundary dates (month/year rollovers, Monday week
 * starts, message-only days) get explicit coverage.
 */

import { describe, expect, it } from "bun:test"
import { weekdayIndex } from "./heatmap"
import {
  computeFacts,
  dailyBuckets,
  fillDaily,
  formatDelta,
  formatShare,
  hasActivity,
  isMessagesOnly,
  isSite,
  levelScale,
  monthlyBuckets,
  shiftDays,
  type Site,
  type SiteDay,
  type SiteRange,
  stackFor,
  type Usage,
  type UsageSpan,
  weekdayProfile,
  windowTotals,
} from "./tokens"

/* Fixtures ------------------------------------------------------------ */

const day = (
  date: string,
  tokens = 0,
  extra: Partial<SiteDay> = {},
): SiteDay => ({
  date,
  tokens,
  cost: 0,
  messages: 0,
  providers: {},
  clients: {},
  ...extra,
})

const usage = (tokens = 0): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  tokens,
  messages: 0,
  cost: 0,
})

const span: UsageSpan = { days: 0, firstDate: null, lastDate: null }

const rangeStats = (
  byProvider: SiteRange["byProvider"] = [],
  byClient: SiteRange["byClient"] = [],
): SiteRange => ({
  from: null,
  totals: { ...usage(), activeDays: 0, firstDate: null, lastDate: null },
  byModel: [],
  byClient,
  byProvider,
})

const site = (
  byProvider: SiteRange["byProvider"] = [],
  byClient: SiteRange["byClient"] = [],
): Site => ({
  generatedAt: "2026-07-20T00:00:00Z",
  today: "2026-07-20",
  ranges: {
    week: rangeStats(),
    month: rangeStats(),
    quarter: rangeStats(),
    all: rangeStats(byProvider, byClient),
  },
  daily: [],
  devices: [],
})

/* Dates ---------------------------------------------------------------- */

describe("shiftDays", () => {
  it("shifts within a month", () => {
    expect(shiftDays("2026-07-20", 1)).toBe("2026-07-21")
    expect(shiftDays("2026-07-20", -3)).toBe("2026-07-17")
    expect(shiftDays("2026-07-20", 0)).toBe("2026-07-20")
  })

  it("rolls over month and year boundaries", () => {
    expect(shiftDays("2026-02-28", 1)).toBe("2026-03-01")
    expect(shiftDays("2025-12-31", 1)).toBe("2026-01-01")
    expect(shiftDays("2026-01-01", -1)).toBe("2025-12-31")
  })

  it("knows leap days", () => {
    expect(shiftDays("2024-02-28", 1)).toBe("2024-02-29")
    expect(shiftDays("2024-03-01", -1)).toBe("2024-02-29")
  })

  it("is stable across DST transitions", () => {
    // US spring-forward 2026 happens on Mar 8; noon-UTC anchoring
    // must keep day arithmetic exact regardless of visitor locale.
    expect(shiftDays("2026-03-07", 2)).toBe("2026-03-09")
    expect(shiftDays("2026-11-01", 1)).toBe("2026-11-02")
  })
})

describe("weekdayIndex", () => {
  it("maps Monday to 0 and Sunday to 6", () => {
    expect(weekdayIndex("2026-07-20")).toBe(0) // Monday
    expect(weekdayIndex("2026-07-19")).toBe(6) // Sunday
    expect(weekdayIndex("2026-01-01")).toBe(3) // Thursday
  })
})

describe("fillDaily", () => {
  it("fills idle gaps with empty days", () => {
    const days = fillDaily(
      [day("2026-07-01", 5), day("2026-07-03", 7)],
      "2026-07-01",
      "2026-07-03",
    )
    expect(days.map((d) => d.date)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ])
    expect(days[0].tokens).toBe(5)
    expect(days[1]).toEqual(day("2026-07-02"))
    expect(days[2].tokens).toBe(7)
  })

  it("spans month and year boundaries", () => {
    const days = fillDaily([], "2025-12-30", "2026-01-02")
    expect(days.map((d) => d.date)).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ])
  })

  it("handles a single-day window and drops days outside it", () => {
    const days = fillDaily(
      [day("2026-07-01", 1), day("2026-07-05", 9)],
      "2026-07-05",
      "2026-07-05",
    )
    expect(days).toHaveLength(1)
    expect(days[0].tokens).toBe(9)
  })
})

/* Aggregation ---------------------------------------------------------- */

describe("hasActivity / isMessagesOnly", () => {
  it("treats message-only days as activity, not idle", () => {
    const messagesOnly = day("2026-07-01", 0, { messages: 12 })
    expect(hasActivity(messagesOnly)).toBe(true)
    expect(isMessagesOnly(messagesOnly)).toBe(true)
    expect(hasActivity(day("2026-07-02"))).toBe(false)
    expect(isMessagesOnly(day("2026-07-03", 5, { messages: 2 }))).toBe(false)
  })
})

describe("windowTotals", () => {
  const daily = [
    day("2026-06-30", 10, { cost: 1, messages: 2 }),
    day("2026-07-01", 20, { cost: 2, messages: 3 }),
    day("2026-07-02", 0, { messages: 5 }), // message-only, still active
    day("2026-07-03", 0),
    day("2026-07-04", 40, { cost: 4, messages: 1 }),
  ]

  it("sums inclusively over [from, to]", () => {
    const totals = windowTotals(daily, "2026-07-01", "2026-07-04")
    expect(totals.tokens).toBe(60)
    expect(totals.cost).toBe(6)
    expect(totals.messages).toBe(9)
  })

  it("counts message-only days as active, idle days not", () => {
    expect(windowTotals(daily, "2026-07-01", "2026-07-04").activeDays).toBe(3)
  })

  it("excludes days outside the window", () => {
    const totals = windowTotals(daily, "2026-07-01", "2026-07-01")
    expect(totals.tokens).toBe(20)
    expect(totals.activeDays).toBe(1)
  })
})

describe("stackFor", () => {
  it("keeps the top ids and appends the residual sentinel", () => {
    const stacked = stackFor(
      site([
        { ...usage(100), ...span, provider: "anthropic" },
        { ...usage(50), ...span, provider: "openai" },
        { ...usage(25), ...span, provider: "google" },
        { ...usage(10), ...span, provider: "xai" },
      ]),
      "provider",
    )
    expect(stacked).toEqual({
      dim: "provider",
      ids: ["anthropic", "openai", "google", "other"],
    })
  })

  it("skips unknown and empty ids", () => {
    const stacked = stackFor(
      site([
        { ...usage(100), ...span, provider: "unknown" },
        { ...usage(50), ...span, provider: "" },
        { ...usage(25), ...span, provider: "openai" },
      ]),
      "provider",
    )
    expect(stacked.ids).toEqual(["openai", "other"])
  })

  it("reads the client dimension from byClient", () => {
    const stacked = stackFor(
      site([], [{ ...usage(10), ...span, client: "cursor" }]),
      "client",
      2,
    )
    expect(stacked).toEqual({ dim: "client", ids: ["cursor", "other"] })
  })
})

describe("dailyBuckets", () => {
  const stack = { dim: "provider" as const, ids: ["anthropic", "other"] }

  it("splits named segments and clamps the residual", () => {
    const [bucket] = dailyBuckets(
      [
        day("2026-07-01", 100, {
          cost: 8,
          messages: 4,
          providers: {
            anthropic: { tokens: 60, cost: 5 },
            openai: { tokens: 40, cost: 3 },
          },
        }),
      ],
      stack,
      "tokens",
    )
    expect(bucket.segments).toEqual([60, 40])
    expect(bucket.tokens).toBe(100)
    expect(bucket.messages).toBe(4)
  })

  it("slices by cost when that metric is selected", () => {
    const [bucket] = dailyBuckets(
      [
        day("2026-07-01", 100, {
          cost: 8,
          providers: { anthropic: { tokens: 60, cost: 5 } },
        }),
      ],
      stack,
      "cost",
    )
    expect(bucket.segments).toEqual([5, 3])
  })

  it("never lets float drift push the residual negative", () => {
    const [bucket] = dailyBuckets(
      [
        day("2026-07-01", 10, {
          providers: { anthropic: { tokens: 10.000001, cost: 0 } },
        }),
      ],
      stack,
      "tokens",
    )
    expect(bucket.segments[1]).toBe(0)
  })
})

describe("monthlyBuckets", () => {
  const stack = { dim: "provider" as const, ids: ["other"] }

  it("collapses days into months and fills idle months to today", () => {
    const buckets = monthlyBuckets(
      [day("2025-11-05", 10), day("2025-11-20", 5), day("2026-01-02", 40)],
      "2026-02-10",
      stack,
      "tokens",
    )
    expect(buckets.map((b) => b.tokens)).toEqual([15, 0, 40, 0])
    expect(buckets[0].title).toBe("November 2025")
    expect(buckets[3].title).toBe("February 2026")
  })

  it("returns nothing for an empty series", () => {
    expect(monthlyBuckets([], "2026-07-20", stack, "tokens")).toEqual([])
  })
})

describe("weekdayProfile", () => {
  // 2026-07-06 is a Monday; two full Mon–Sun weeks.
  const twoWeeks = fillDaily(
    [
      day("2026-07-06", 10), // Monday, week 1
      day("2026-07-13", 30), // Monday, week 2
      day("2026-07-07", 10), // Tuesday, week 1 (week 2 Tuesday idle)
      day("2026-07-12", 0, { messages: 3 }), // Sunday, message-only
    ],
    "2026-07-06",
    "2026-07-19",
  )

  it("averages over occurrences, idle days included", () => {
    const stats = weekdayProfile(twoWeeks, "tokens")
    expect(stats[0]).toEqual({
      weekday: 0,
      average: 20,
      total: 40,
      occurrences: 2,
      activeDays: 2,
    })
    expect(stats[1].average).toBe(5) // one 10-token Tuesday of two
  })

  it("counts message-only days as active", () => {
    const stats = weekdayProfile(twoWeeks, "tokens")
    expect(stats[6].activeDays).toBe(1)
    expect(stats[6].average).toBe(0)
  })
})

/* Facts ---------------------------------------------------------------- */

describe("computeFacts", () => {
  it("returns empty facts for an empty series", () => {
    expect(computeFacts([])).toEqual({
      biggest: null,
      busiestWeek: null,
      median: null,
      weekday: null,
      longest: null,
      current: null,
    })
  })

  it("finds the biggest day and the median across active days", () => {
    const facts = computeFacts([
      day("2026-07-01", 10),
      day("2026-07-02", 0),
      day("2026-07-03", 30),
      day("2026-07-04", 20),
    ])
    expect(facts.biggest?.date).toBe("2026-07-03")
    expect(facts.median).toBe(20)
  })

  it("averages the middle pair for an even count of active days", () => {
    const facts = computeFacts([
      day("2026-07-01", 10),
      day("2026-07-02", 20),
      day("2026-07-03", 30),
      day("2026-07-04", 40),
    ])
    expect(facts.median).toBe(25)
  })

  it("keeps streaks alive through message-only days", () => {
    const facts = computeFacts([
      day("2026-07-01", 10),
      day("2026-07-02", 0, { messages: 4 }),
      day("2026-07-03", 5),
      day("2026-07-04", 0),
      day("2026-07-05", 1),
    ])
    expect(facts.longest).toEqual({
      length: 3,
      from: "2026-07-01",
      to: "2026-07-03",
    })
  })

  it("forgives only a idle today for the current streak", () => {
    const active = [
      day("2026-07-17", 1),
      day("2026-07-18", 2),
      day("2026-07-19", 3),
    ]
    const idleToday = computeFacts([...active, day("2026-07-20", 0)])
    expect(idleToday.current).toEqual({ length: 3, since: "2026-07-17" })

    const idleTwoDays = computeFacts([
      ...active.slice(0, 2),
      day("2026-07-19", 0),
      day("2026-07-20", 0),
    ])
    expect(idleTwoDays.current).toBeNull()
  })

  it("buckets the busiest week from Monday", () => {
    // 2026-07-13 is a Monday: 10 tokens spread over week 1, then a
    // single 50-token Tuesday in week 2.
    const facts = computeFacts(
      fillDaily(
        [day("2026-07-13", 4), day("2026-07-16", 6), day("2026-07-21", 50)],
        "2026-07-13",
        "2026-07-22",
      ),
    )
    expect(facts.busiestWeek).toEqual({
      from: "2026-07-20",
      to: "2026-07-22",
      tokens: 50,
    })
  })

  it("names the top weekday with its token share", () => {
    const facts = computeFacts([
      day("2026-07-13", 75), // Monday
      day("2026-07-14", 25), // Tuesday
    ])
    expect(facts.weekday).toEqual({ name: "Monday", share: 0.75 })
  })
})

describe("levelScale", () => {
  it("returns level 0 for a series with no active days", () => {
    const level = levelScale([day("2026-07-01"), day("2026-07-02")])
    expect(level(0)).toBe(0)
    expect(level(100)).toBe(0)
  })

  it("grades by quartiles of active days", () => {
    const level = levelScale([
      day("2026-07-01", 10),
      day("2026-07-02", 20),
      day("2026-07-03", 30),
      day("2026-07-04", 40),
      day("2026-07-05", 0),
    ])
    expect(level(0)).toBe(0)
    expect(level(10)).toBe(1)
    expect(level(25)).toBe(2)
    expect(level(35)).toBe(3)
    expect(level(45)).toBe(4)
  })

  it("keeps contrast when one huge day would flatten a linear scale", () => {
    // A linear /max scale would grade the 2- and 3-token days both as
    // level 1; quartiles keep them apart from each other and the peak.
    const level = levelScale([
      day("2026-07-01", 1),
      day("2026-07-02", 2),
      day("2026-07-03", 3),
      day("2026-07-04", 1000),
    ])
    expect(level(2)).toBe(1)
    expect(level(3)).toBe(2)
    expect(level(1000)).toBe(3)
    expect(level(1500)).toBe(4)
  })
})

/* Formatting ----------------------------------------------------------- */

describe("formatDelta", () => {
  it("formats rises, falls and no change", () => {
    expect(formatDelta(0.23)).toBe("↑ 23%")
    expect(formatDelta(-0.08)).toBe("↓ 8.0%")
    expect(formatDelta(0)).toBe("→ 0.0%")
  })

  it("switches to a multiple beyond +200%", () => {
    expect(formatDelta(2.4)).toBe("↑ 3.4×")
  })
})

describe("formatShare", () => {
  it("clamps the readable edges", () => {
    expect(formatShare(0.0005)).toBe("<0.1%")
    expect(formatShare(0.9996)).toBe("100%")
    expect(formatShare(0.421)).toBe("42.1%")
    expect(formatShare(Number.NaN)).toBe("—")
  })
})

/* Payload decoding ------------------------------------------------------ */

describe("isSite", () => {
  it("accepts the minimal well-formed payload", () => {
    expect(isSite(site())).toBe(true)
  })

  it("rejects payloads missing the spine the dashboard indexes", () => {
    expect(isSite(null)).toBe(false)
    expect(isSite([])).toBe(false)
    expect(isSite({})).toBe(false)
    expect(isSite({ ...site(), daily: "nope" })).toBe(false)
    const missingRange = site()
    // @ts-expect-error deliberately breaking the shape
    delete missingRange.ranges.quarter
    expect(isSite(missingRange)).toBe(false)
    const badBreakdown = site()
    // @ts-expect-error deliberately breaking the shape
    badBreakdown.ranges.all.byModel = {}
    expect(isSite(badBreakdown)).toBe(false)
  })
})
