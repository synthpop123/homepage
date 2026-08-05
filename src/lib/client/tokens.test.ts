/**
 * Tests for the pure data layer behind the Tokens dashboard. The
 * date, aggregation and streak logic here is what the dashboard
 * renders from, so boundary dates (month/year rollovers, Monday week
 * starts, message-only days) get explicit coverage.
 */

import { describe, expect, it } from "bun:test"
import { weekdayIndex } from "./heatmap"
import {
  activeTotals,
  aiIcon,
  clientLabel,
  computeFacts,
  dailyBuckets,
  fillDaily,
  formatDelta,
  formatShare,
  hasActivity,
  isMessagesOnly,
  isSite,
  lastReport,
  levelScale,
  modelBrand,
  modelLabel,
  monthlyBuckets,
  perHour,
  providerLabel,
  RANGE_KEYS,
  shiftDays,
  type Site,
  SITE_SCHEMA_VERSION,
  type SiteDay,
  type SiteRange,
  type StackDim,
  stackFor,
  stackPaint,
  todayView,
  type Usage,
  type UsageSpan,
  weekdayProfile,
  windowTotals,
} from "./tokens"
import fixture from "./tokens.site-fixture.json"

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
  models: {},
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

const device = (): Site["devices"][number] => ({
  name: "MacbookPro",
  firstSeen: 1784199105234,
  lastSeen: 1784989231554,
  cliVersion: "3.1.0",
  sessions: 12,
  activeMs: 3_600_000,
  longestMs: 1_200_000,
  maxConcurrent: 2,
  mcpServers: ["context7"],
  activeDays: 3,
  tokens: 100,
  messages: 5,
  cost: 1.5,
})

const modelRows = (
  ...models: [model: string, tokens: number, cost?: number][]
): SiteRange["byModel"] =>
  models.map(([model, tokens, cost = 0]) => ({
    ...usage(tokens),
    ...span,
    cost,
    model,
    providers: "anthropic",
  }))

const rangeStats = (
  byProvider: SiteRange["byProvider"] = [],
  byClient: SiteRange["byClient"] = [],
  byModel: SiteRange["byModel"] = [],
): SiteRange => ({
  from: null,
  totals: { ...usage(), activeDays: 0, firstDate: null, lastDate: null },
  byModel,
  byClient,
  byProvider,
})

const site = (
  byProvider: SiteRange["byProvider"] = [],
  byClient: SiteRange["byClient"] = [],
): Site => ({
  schemaVersion: SITE_SCHEMA_VERSION,
  generatedAt: "2026-07-20T00:00:00Z",
  today: "2026-07-20",
  ranges: {
    day: rangeStats(),
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
      rangeStats([
        { ...usage(100), ...span, provider: "anthropic" },
        { ...usage(50), ...span, provider: "openai" },
        { ...usage(25), ...span, provider: "google" },
        { ...usage(10), ...span, provider: "xai" },
      ]),
      "provider",
      "tokens",
    )
    expect(stacked).toEqual({
      dim: "provider",
      ids: ["anthropic", "openai", "google", "other"],
    })
  })

  it("skips placeholder and empty ids", () => {
    const stacked = stackFor(
      rangeStats([
        { ...usage(100), ...span, provider: "unknown" },
        { ...usage(50), ...span, provider: "" },
        { ...usage(25), ...span, provider: "openai" },
      ]),
      "provider",
      "tokens",
    )
    expect(stacked.ids).toEqual(["openai", "other"])
    // Same treatment on the model dimension, where the collector also
    // reports Cursor's <synthetic> placeholder.
    expect(
      stackFor(
        rangeStats(
          [],
          [],
          modelRows(
            ["unknown", 100],
            ["<synthetic>", 80],
            ["claude-opus-5", 25],
          ),
        ),
        "model",
        "tokens",
      ).ids,
    ).toEqual(["claude-opus-5", "other"])
  })

  // Three is right for ~8 providers whose top three carry everything;
  // models are 40-odd and the interesting picture is a handover, which
  // needs room for what was displaced as well.
  it("gives the model dimension a wider default cutoff", () => {
    const stacked = stackFor(
      rangeStats(
        [],
        [],
        modelRows(
          ["claude-opus-5", 60],
          ["claude-fable-5", 50],
          ["gpt-5.6-sol", 40],
          ["claude-sonnet-5", 30],
          ["gemini-3-pro", 20],
          ["grok-4.5", 10],
        ),
      ),
      "model",
      "tokens",
    )
    expect(stacked.ids).toEqual([
      "claude-opus-5",
      "claude-fable-5",
      "gpt-5.6-sol",
      "claude-sonnet-5",
      "gemini-3-pro",
      "other",
    ])
  })
})

describe("stackPaint", () => {
  it("paints provider and client ids with their own hue, unshaded", () => {
    expect(
      stackPaint({ dim: "provider", ids: ["anthropic", "other"] }),
    ).toEqual([
      { p: "anthropic", shade: 0 },
      { p: "other", shade: 0 },
    ])
  })

  // The point of the shade ramp: a stack of five models must not be five
  // unrelated colors, nor two identical corals.
  it("gives models their vendor's hue and separates them by shade", () => {
    const paints = stackPaint({
      dim: "model",
      ids: [
        "claude-opus-5",
        "gpt-5.6-sol",
        "claude-fable-5",
        "claude-sonnet-5",
        "other",
      ],
    })
    expect(paints).toEqual([
      { p: "claude", shade: 0 },
      { p: "openai", shade: 0 },
      { p: "claude", shade: 1 },
      { p: "claude", shade: 2 },
      { p: "other", shade: 0 },
    ])
  })

  it("keeps unplaceable models off the residual's exact grey", () => {
    const paints = stackPaint({
      dim: "model",
      ids: ["brand-new-model", "another-new-model", "other"],
    })
    expect(paints).toEqual([
      { p: "other", shade: 1 },
      { p: "other", shade: 2 },
      { p: "other", shade: 0 },
    ])
  })

  it("stops the ramp where tints stop being tellable apart", () => {
    const paints = stackPaint({
      dim: "model",
      ids: Array.from({ length: 6 }, (_, i) => `claude-opus-${i}`),
    })
    expect(paints.map((paint) => paint.shade)).toEqual([0, 1, 2, 3, 3, 3])
  })

  it("reads the client dimension from byClient", () => {
    const stacked = stackFor(
      rangeStats([], [{ ...usage(10), ...span, client: "cursor" }]),
      "client",
      "tokens",
    )
    expect(stacked).toEqual({ dim: "client", ids: ["cursor", "other"] })
  })

  // The regression the range-scoped signature exists to prevent: a
  // provider that dominates all time but has gone quiet must not hold a
  // colored slot in a shorter window that someone else is driving.
  it("ranks within the range it is given, not all time", () => {
    const stacked = stackFor(
      rangeStats([
        { ...usage(10), ...span, provider: "deepseek" },
        { ...usage(1), ...span, provider: "cursor" },
      ]),
      "provider",
      "tokens",
    )
    expect(stacked.ids).toEqual(["deepseek", "cursor", "other"])
  })

  // ...and by the metric being drawn, not always by tokens. A model can
  // be a small share of the volume and a large share of the bill, and
  // folding it into "other" leaves the cost chart unable to name what
  // drove the cost. The payload arrives tokens-desc, so this is the one
  // ordering the stack has to redo itself.
  it("ranks by the metric the chart is drawn in", () => {
    const range = rangeStats(
      [],
      [],
      modelRows(
        ["deepseek-v4-flash", 100, 0.1],
        ["gpt-5.6-sol", 90, 0.2],
        ["claude-opus-5", 80, 0.3],
        ["claude-sonnet-5", 70, 0.4],
        ["gemini-3-pro", 60, 0.5],
        ["qwen3.8-max", 10, 9],
      ),
    )
    const byTokens = stackFor(range, "model", "tokens").ids
    expect(byTokens).toEqual([
      "deepseek-v4-flash",
      "gpt-5.6-sol",
      "claude-opus-5",
      "claude-sonnet-5",
      "gemini-3-pro",
      "other",
    ])
    const byCost = stackFor(range, "model", "cost").ids
    expect(byCost[0]).toBe("qwen3.8-max")
    expect(byCost).not.toContain("deepseek-v4-flash")
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

  it("slices by model when that dimension is charted", () => {
    const [bucket] = dailyBuckets(
      [
        day("2026-07-01", 100, {
          models: {
            "claude-opus-5": { tokens: 70, cost: 6 },
            "gpt-5.6-sol": { tokens: 30, cost: 2 },
          },
          providers: { anthropic: { tokens: 100, cost: 8 } },
        }),
      ],
      { dim: "model", ids: ["claude-opus-5", "other"] },
      "tokens",
    )
    expect(bucket.segments).toEqual([70, 30])
  })

  // A payload composed before the collector shipped per-day model slices
  // has no `models` key at all; charting it must not throw.
  it("treats a day without model slices as all residual", () => {
    const [bucket] = dailyBuckets(
      [day("2026-07-01", 100)],
      { dim: "model", ids: ["claude-opus-5", "other"] },
      "tokens",
    )
    expect(bucket.segments).toEqual([0, 100])
  })

  it("carries active time and the usage of the days that reported it", () => {
    const [bucket] = monthlyBuckets(
      [
        day("2026-07-01", 100, { active: 3_600_000 }),
        day("2026-07-02", 40), // untracked: neither hours nor its tokens
      ],
      "2026-07-02",
      { dim: "provider", ids: ["other"] },
      "tokens",
    )
    expect(bucket.tokens).toBe(140)
    expect(bucket.active).toBe(3_600_000)
    expect(bucket.activeMetric).toBe(100)
    expect(perHour(bucket.activeMetric, bucket.active)).toBe(100)
  })
})

describe("activeTotals", () => {
  it("sums only the days the CLI timed, usage included", () => {
    const totals = activeTotals([
      day("2026-07-01", 100, { cost: 4, active: 3_600_000 }),
      day("2026-07-02", 50, { cost: 2 }), // no active time reported
      day("2026-07-03", 20, { cost: 1, active: 1_800_000 }),
    ])
    expect(totals).toEqual({ ms: 5_400_000, days: 2, tokens: 120, cost: 5 })
    // The ratio divides two numbers about the same two days.
    expect(perHour(totals.tokens, totals.ms)).toBe(80)
  })

  it("reads nothing out of an untracked series", () => {
    expect(activeTotals([day("2026-07-01", 100)])).toEqual({
      ms: 0,
      days: 0,
      tokens: 0,
      cost: 0,
    })
    expect(perHour(100, 0)).toBe(0)
  })
})

describe("lastReport", () => {
  it("takes the newest device sync, ignoring devices that never reported", () => {
    expect(
      lastReport({
        ...site(),
        devices: [
          { ...device(), lastSeen: 1_784_000_000_000 },
          { ...device(), lastSeen: null },
          { ...device(), lastSeen: 1_785_000_000_000 },
        ],
      }),
    ).toBe(1_785_000_000_000)
  })

  it("is null when nothing has ever reported", () => {
    expect(lastReport(site())).toBeNull()
    expect(
      lastReport({ ...site(), devices: [{ ...device(), lastSeen: null }] }),
    ).toBeNull()
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

/* Today ----------------------------------------------------------------- */

describe("todayView", () => {
  const TODAY = "2026-07-20"
  const EVE = "2026-07-19"

  const clientRow = (client: string, tokens: number) => ({
    ...usage(tokens),
    ...span,
    client,
  })

  const modelRow = (model: string, tokens: number) => ({
    ...usage(tokens),
    ...span,
    model,
    providers: "anthropic",
  })

  /** A site whose only populated range is `day`, plus a daily series. */
  const todaySite = (
    day: Omit<Partial<SiteRange>, "totals"> & {
      totals?: Partial<SiteRange["totals"]>
    },
    daily: SiteDay[] = [],
  ): Site => {
    const base = site()
    return {
      ...base,
      today: TODAY,
      ranges: {
        ...base.ranges,
        day: {
          ...rangeStats(),
          ...day,
          from: TODAY,
          totals: { ...rangeStats().totals, ...day.totals },
        },
      },
      daily,
    }
  }

  it("is idle only when nothing at all was recorded", () => {
    expect(todayView(todaySite({})).idle).toBe(true)
    expect(todayView(todaySite({ totals: { tokens: 10 } })).idle).toBe(false)
    expect(todayView(todaySite({ totals: { messages: 3 } })).idle).toBe(false)
    expect(todayView(todaySite({ totals: { cost: 0.4 } })).idle).toBe(false)
  })

  it("counts CLI-reported active time as activity of its own", () => {
    // activeTimeMs is stored and displayed independently of tokens, and
    // a submission carrying only active time passes validation — the
    // section must not answer "nothing logged" while holding a duration.
    const view = todayView(
      todaySite({}, [day(TODAY, 0, { active: 1_800_000 })]),
    )
    expect(view.idle).toBe(false)
    expect(view.active).toBe(1_800_000)
    // No tokens means no breakdown to draw.
    expect(view.mix).toEqual([])
    expect(view.models).toEqual([])
  })

  it("baselines against yesterday, active time included", () => {
    const view = todayView(
      todaySite({ totals: { tokens: 300, cost: 3, messages: 9 } }, [
        day(EVE, 100, { cost: 1, messages: 4, active: 600_000 }),
        day(TODAY, 300, { cost: 3, messages: 9, active: 900_000 }),
      ]),
    )
    expect(view.before).toMatchObject({
      tokens: 100,
      cost: 1,
      messages: 4,
      active: 600_000,
    })
    expect(view.active).toBe(900_000)
  })

  it("reads no baseline when yesterday is missing from the series", () => {
    const view = todayView(
      todaySite({ totals: { tokens: 300 } }, [day(TODAY, 300)]),
    )
    expect(view.before).toMatchObject({ tokens: 0, active: 0 })
  })

  it("keeps the top clients and merges the tail into one segment", () => {
    const view = todayView(
      todaySite({
        totals: { tokens: 100 },
        byClient: [
          clientRow("claude", 40),
          clientRow("codex", 30),
          clientRow("cursor", 15),
          clientRow("pi", 10),
          clientRow("zed", 3),
          clientRow("gemini", 2),
          clientRow("hermes", 0), // no tokens today: not a segment
        ],
      }),
    )
    expect(view.mix.map((entry) => entry.id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "pi",
      "other",
    ])
    expect(view.mix.at(-1)).toMatchObject({ tokens: 5, label: "Other" })
    expect(view.mix.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(
      1,
      10,
    )
  })

  it("labels client ids that shadow Object members as themselves", () => {
    // Client ids come off the wire unconstrained; a plain-object label
    // table would answer `constructor` with a native function, and the
    // legend would print its source text.
    const view = todayView(
      todaySite({
        totals: { tokens: 10 },
        byClient: [clientRow("constructor", 6), clientRow("__proto__", 4)],
      }),
    )
    expect(view.mix.map((entry) => entry.label)).toEqual([
      "constructor",
      "__proto__",
    ])
  })

  // Placeholder ids are rendered, not hidden — a list whose shares are
  // meant to sum to the day cannot silently drop rows. They are labelled
  // the way the client and provider tables label theirs.
  it("keeps unattributed usage in the list and caps it at five", () => {
    const view = todayView(
      todaySite({
        totals: { tokens: 100 },
        byModel: [
          modelRow("unknown", 50),
          ...Array.from({ length: 6 }, (_, i) => modelRow(`m-${i}`, 10 - i)),
          modelRow("m-idle", 0),
        ],
      }),
    )
    expect(view.models.map((row) => row.model)).toEqual([
      "unknown",
      "m-0",
      "m-1",
      "m-2",
      "m-3",
    ])
    expect(modelLabel("unknown")).toBe("Other")
  })
})

describe("labels and icons", () => {
  it("falls back to the raw id for ids that shadow Object members", () => {
    for (const id of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(clientLabel(id)).toBe(id)
      expect(providerLabel(id)).toBe(id)
      expect(aiIcon("client", id)).toBeNull()
      expect(aiIcon("provider", id)).toBeNull()
      expect(aiIcon("model", id)).toBeNull()
    }
  })

  it("still resolves the known ids", () => {
    expect(clientLabel("claude")).toBe("Claude Code")
    expect(clientLabel("other")).toBe("Other")
    expect(clientLabel("brand-new-cli")).toBe("brand-new-cli")
    expect(providerLabel("zed.dev")).toBe("Zed")
    expect(providerLabel("alibaba")).toBe("Alibaba")
    expect(aiIcon("client", "claude")).toBe("claudecode")
    expect(aiIcon("provider", "moonshotai")).toBe("moonshot")
    expect(aiIcon("provider", "deepseek")).toBe("deepseek")
    expect(aiIcon("provider", "alibaba")).toBe("alibaba")
    expect(aiIcon("model", "claude-opus-5")).toBe("claude")
    expect(aiIcon("model", "deepseek-v4-flash")).toBe("deepseek")
    expect(aiIcon("model", "qwen3.8-max")).toBe("qwen")
  })

  // The icon slug and the [data-p] palette key are the same brand key,
  // which is what lets a model band wear its vendor's color without a
  // CSS rule per model id.
  it("places models on their vendor's brand key", () => {
    expect(modelBrand("claude-opus-4-5")).toBe("claude")
    expect(modelBrand("gpt-5.6-sol")).toBe("openai")
    expect(modelBrand("o3")).toBe("openai")
    expect(modelBrand("glm-4.7")).toBe("zai")
    expect(modelBrand("composer-2.5")).toBe("cursor")
    expect(modelBrand("brand-new-model")).toBeNull()
    expect(modelBrand("unknown")).toBeNull()
  })

  it("labels the collector's placeholder model ids", () => {
    expect(modelLabel("unknown")).toBe("Other")
    expect(modelLabel("<synthetic>")).toBe("Synthetic")
  })

  it("humanizes model ids into display names", () => {
    // Exact overrides keep their canonical brand spelling.
    expect(modelLabel("deepseek-v4-flash")).toBe("DeepSeek V4 Flash")
    // Generic path: split into words, Title Case, dot-join versions.
    expect(modelLabel("claude-fable-5")).toBe("Claude Fable 5")
    expect(modelLabel("claude-opus-4-5")).toBe("Claude Opus 4.5")
    expect(modelLabel("claude-haiku-4-5")).toBe("Claude Haiku 4.5")
    expect(modelLabel("gemini-2.5-pro")).toBe("Gemini 2.5 Pro")
    expect(modelLabel("gpt-5.2-codex")).toBe("GPT 5.2 Codex")
    expect(modelLabel("kimi-k2")).toBe("Kimi K2")
    // A lone unknown id falls back to the raw string.
    expect(modelLabel("brand-new-model")).toBe("Brand New Model")
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

  it("accepts exactly the version this build was written against", () => {
    expect(isSite({ ...site(), schemaVersion: SITE_SCHEMA_VERSION })).toBe(true)
    for (const version of [
      undefined,
      String(SITE_SCHEMA_VERSION),
      SITE_SCHEMA_VERSION - 1,
      SITE_SCHEMA_VERSION + 1,
    ]) {
      expect(isSite({ ...site(), schemaVersion: version })).toBe(false)
    }
  })

  // Model slices are part of the schema now — a missing or malformed
  // map is a rejection, not a shrug.
  it("requires per-day model slices", () => {
    const withModels = site()
    withModels.daily = [
      day("2026-07-20", 5, {
        models: { "claude-opus-5": { tokens: 5, cost: 1 } },
      }),
    ]
    expect(isSite(withModels)).toBe(true)

    const withoutModels = site()
    withoutModels.daily = [
      {
        date: "2026-07-20",
        tokens: 5,
        cost: 0,
        messages: 0,
        providers: {},
        clients: {},
      } as SiteDay,
    ]
    expect(isSite(withoutModels)).toBe(false)

    const badModels = site()
    badModels.daily = [
      { ...day("2026-07-20", 5), models: { "claude-opus-5": { tokens: "5" } } },
    ] as unknown as SiteDay[]
    expect(isSite(badModels)).toBe(false)
  })

  it("rejects payloads missing the spine the dashboard indexes", () => {
    expect(isSite(null)).toBe(false)
    expect(isSite([])).toBe(false)
    expect(isSite({})).toBe(false)
    expect(isSite({ ...site(), daily: "nope" })).toBe(false)
    // generatedAt is the freshness key the SWR path compares on.
    expect(isSite({ ...site(), generatedAt: undefined })).toBe(false)
    const missingRange = site()
    // @ts-expect-error deliberately breaking the shape
    delete missingRange.ranges.quarter
    expect(isSite(missingRange)).toBe(false)
    // "day" is not in the range selector but the Today section reads it,
    // so it is part of the spine like any other range.
    const missingDay = site()
    // @ts-expect-error deliberately breaking the shape
    delete missingDay.ranges.day
    expect(isSite(missingDay)).toBe(false)
    const badBreakdown = site()
    // @ts-expect-error deliberately breaking the shape
    badBreakdown.ranges.all.byModel = {}
    expect(isSite(badBreakdown)).toBe(false)
  })

  it("rejects dates the renderers would feed to Date and Intl", () => {
    // Not pedantry: shiftDays() calls toISOString() on the parsed day,
    // and that *throws* on an Invalid Date — a malformed cache entry
    // would take the whole dashboard down rather than fall back.
    expect(isSite({ ...site(), today: "yesterday" })).toBe(false)
    expect(isSite({ ...site(), today: "2026-07-20T00:00:00Z" })).toBe(false)
    expect(isSite({ ...site(), generatedAt: "soon" })).toBe(false)

    const badDay = site()
    badDay.daily = [day("20/07/2026", 5)]
    expect(isSite(badDay)).toBe(false)

    const badFrom = site()
    badFrom.ranges.week.from = "last monday"
    expect(isSite(badFrom)).toBe(false)

    const badSpan = site([{ ...usage(10), ...span, provider: "anthropic" }])
    badSpan.ranges.all.byProvider[0].firstDate = "n/a"
    expect(isSite(badSpan)).toBe(false)

    // Nulls still mean "no dates in this range", as the producer emits
    // for an empty window.
    expect(isSite(site())).toBe(true)
  })

  it("rejects rows missing fields the renderers read unconditionally", () => {
    // A daily row without its slice maps used to crash the trend
    // chart's Object.entries() — the exact stale-cache failure the
    // schema version + strict decoding exist to prevent.
    const noSlices = site()
    noSlices.daily = [
      { date: "2026-07-20", tokens: 1, cost: 0, messages: 1 } as SiteDay,
    ]
    expect(isSite(noSlices)).toBe(false)

    const partialTotals = site()
    // @ts-expect-error deliberately breaking the shape
    delete partialTotals.ranges.week.totals.cacheRead
    expect(isSite(partialTotals)).toBe(false)

    const spanless = site([
      // @ts-expect-error deliberately breaking the shape
      { ...usage(10), provider: "anthropic" },
    ])
    expect(isSite(spanless)).toBe(false)

    const namelessDevice = site()
    namelessDevice.devices = [{ activeDays: 1 } as Site["devices"][number]]
    expect(isSite(namelessDevice)).toBe(false)
  })

  it("rejects device metadata whose types would crash the renderer", () => {
    const withDevice = (overrides: Record<string, unknown>) => ({
      ...site(),
      devices: [{ ...device(), ...overrides }],
    })
    expect(isSite(withDevice({}))).toBe(true)
    expect(
      isSite(
        withDevice({
          cliVersion: null,
          sessions: null,
          activeMs: null,
          longestMs: null,
          maxConcurrent: null,
          mcpServers: null,
        }),
      ),
    ).toBe(true)
    // A string has a truthy .length but no .join() — the exact crash
    // the device tooltip would hit on a malformed cached payload.
    expect(isSite(withDevice({ mcpServers: "context7" }))).toBe(false)
    expect(isSite(withDevice({ mcpServers: ["context7", 1] }))).toBe(false)
    expect(isSite(withDevice({ mcpServers: undefined }))).toBe(false)
    expect(isSite(withDevice({ sessions: "12" }))).toBe(false)
    expect(isSite(withDevice({ activeMs: {} }))).toBe(false)
    expect(isSite(withDevice({ maxConcurrent: Number.NaN }))).toBe(false)
    expect(isSite(withDevice({ cliVersion: 3.1 }))).toBe(false)
    expect(isSite(withDevice({ lastSeen: "yesterday" }))).toBe(false)
  })
})

/* Producer contract ----------------------------------------------------- */

describe("/api/site fixture contract", () => {
  // Captured /api/site payload; producer-side assertions live in
  // tokens-worker/test/site.spec.ts.
  it("passes the strict decoder", () => {
    // Recapture the fixture from the live endpoint (never hand-edit it)
    // when tokens-worker bumps SITE_VERSION.
    expect(fixture.schemaVersion).toBe(SITE_SCHEMA_VERSION)
    expect(isSite(fixture)).toBe(true)
  })

  it("is composed as of its own `today`", () => {
    if (!isSite(fixture)) throw new Error("fixture failed decoding")
    // The payload is a view as of the collector's day: submissions may
    // legitimately carry dates up to two days ahead, but every window
    // the dashboard draws ends today, and Today's active time is
    // matched by exact date — a row past `today` would show up in the
    // day range while the active-time card ignored it.
    for (const day of fixture.daily) {
      expect(day.date <= fixture.today).toBe(true)
    }
    for (const key of RANGE_KEYS) {
      const { totals } = fixture.ranges[key]
      expect(totals.lastDate === null || totals.lastDate <= fixture.today).toBe(
        true,
      )
    }
    expect(fixture.ranges.day.from).toBe(fixture.today)
  })

  it("derives a Today view that agrees with the daily series", () => {
    if (!isSite(fixture)) throw new Error("fixture failed decoding")
    const view = todayView(fixture)
    const today = fixture.daily.find((day) => day.date === fixture.today)
    expect(view.idle).toBe(false)
    expect(view.totals.tokens).toBe(today?.tokens ?? 0)
    expect(view.totals.messages).toBe(today?.messages ?? 0)
    expect(view.totals.cost).toBeCloseTo(today?.cost ?? 0, 6)
    // The mix apportions the whole day, whatever the client count.
    expect(view.mix.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(
      view.totals.tokens,
    )
  })

  it("feeds the render paths the dashboard actually runs", () => {
    if (!isSite(fixture)) throw new Error("fixture failed decoding")
    const dims: StackDim[] = ["provider", "client", "model"]
    for (const dim of dims) {
      const stack = stackFor(fixture.ranges.all, dim, "tokens")
      expect(stack.ids.length).toBeGreaterThan(1)
      expect(stackPaint(stack)).toHaveLength(stack.ids.length)
      const buckets = dailyBuckets(fixture.daily, stack, "tokens")
      expect(buckets).toHaveLength(fixture.daily.length)
      // Every day's stack segments add back up to the day's total.
      for (const [i, bucket] of buckets.entries()) {
        const sum = bucket.segments.reduce((a, b) => a + b, 0)
        expect(sum).toBeCloseTo(fixture.daily[i].tokens, 5)
      }
    }
    const facts = computeFacts(
      fillDaily(
        fixture.daily,
        fixture.daily[0].date,
        fixture.daily[fixture.daily.length - 1].date,
      ),
    )
    expect(facts.biggest).not.toBeNull()
  })
})
