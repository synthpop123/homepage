import { describe, expect, it } from "bun:test"
import { weekdayIndex } from "../feed"
import {
  activeTotals,
  computeFacts,
  dailyBuckets,
  dayView,
  fillDaily,
  hasActivity,
  isMessagesOnly,
  lastReport,
  levelScale,
  modelVendors,
  monthlyBuckets,
  perHour,
  stackFor,
  stackPaint,
  weekdayProfile,
  windowTotals,
} from "./aggregate"
import type { Site, SiteDay } from "./schema"
import {
  day,
  dayClient,
  usage,
  span,
  device,
  modelRows,
  providerRows,
  rangeStats,
  site,
} from "./test-helpers"

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
      rangeStats(
        providerRows(
          ["anthropic", 100],
          ["openai", 50],
          ["google", 25],
          ["xai", 10],
        ),
      ),
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
      rangeStats(providerRows(["unknown", 100], ["", 50], ["openai", 25])),
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

  // One cutoff for every dimension: four legend entries is what fits on
  // a single line under the chart, and the top three carry almost
  // everything in all three id spaces.
  it("cuts every dimension at the same three", () => {
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
      "other",
    ])
  })
})

describe("stackPaint", () => {
  it("paints provider and client ids with their own hue, unshaded", () => {
    expect(
      stackPaint({ dim: "provider", ids: ["anthropic", "other"] }, new Map()),
    ).toEqual([
      { p: "anthropic", shade: 0 },
      { p: "other", shade: 0 },
    ])
  })

  // The point of the shade ramp: a stack of five models must not be five
  // unrelated colors, nor two identical corals.
  it("gives models their vendor's hue and separates them by shade", () => {
    const paints = stackPaint(
      {
        dim: "model",
        ids: [
          "claude-opus-5",
          "gpt-5.6-sol",
          "claude-fable-5",
          "claude-sonnet-5",
          "other",
        ],
      },
      new Map([
        ["claude-opus-5", "anthropic"],
        ["gpt-5.6-sol", "openai"],
        ["claude-fable-5", "anthropic"],
        ["claude-sonnet-5", "anthropic"],
      ]),
    )
    expect(paints).toEqual([
      { p: "anthropic", shade: 0 },
      { p: "openai", shade: 0 },
      { p: "anthropic", shade: 1 },
      { p: "anthropic", shade: 2 },
      { p: "other", shade: 0 },
    ])
  })

  it("keeps unplaceable models off the residual's exact grey", () => {
    const paints = stackPaint(
      {
        dim: "model",
        ids: ["brand-new-model", "another-new-model", "other"],
      },
      new Map(),
    )
    expect(paints).toEqual([
      { p: "other", shade: 1 },
      { p: "other", shade: 2 },
      { p: "other", shade: 0 },
    ])
  })

  it("stops the ramp where tints stop being tellable apart", () => {
    const paints = stackPaint(
      {
        dim: "model",
        ids: Array.from({ length: 6 }, (_, i) => `claude-opus-${i}`),
      },
      new Map(
        Array.from({ length: 6 }, (_, i) => [`claude-opus-${i}`, "anthropic"]),
      ),
    )
    expect(paints.map((paint) => paint.shade)).toEqual([0, 1, 2, 3, 3, 3])
  })

  it("reads the client dimension from byClient", () => {
    const stacked = stackFor(
      rangeStats([], [{ ...usage(10), ...span, client: "cursor", models: [] }]),
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
      rangeStats(providerRows(["deepseek", 10], ["cursor", 1])),
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

  // The day carries no model marginal of its own: it is summed back out
  // of the client × model join.
  it("slices by model, summing the clients behind each one", () => {
    const [bucket] = dailyBuckets(
      [
        day("2026-07-01", 100, {
          clients: {
            "claude-code": dayClient(80, 7, {
              "claude-opus-5": { tokens: 50, cost: 5 },
              "gpt-5.6-sol": { tokens: 30, cost: 2 },
            }),
            zed: dayClient(20, 1, {
              "claude-opus-5": { tokens: 20, cost: 1 },
            }),
          },
          providers: { anthropic: { tokens: 100, cost: 8 } },
        }),
      ],
      { dim: "model", ids: ["claude-opus-5", "other"] },
      "tokens",
    )
    expect(bucket.segments).toEqual([70, 30])
  })

  // A day whose clients name no model — usage the collector could not
  // attribute — still charts, as one residual band.
  it("treats a day without model slices as all residual", () => {
    const [bucket] = dailyBuckets(
      [
        day("2026-07-01", 100, {
          clients: { "claude-code": dayClient(100, 8) },
        }),
      ],
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

describe("dayView", () => {
  const TODAY = "2026-07-20"
  const EVE = "2026-07-19"

  const daySite = (...daily: SiteDay[]): Site => ({
    ...site(),
    today: TODAY,
    daily,
  })

  /** A day's clients, as `tokens[, models]` per id. */
  const clients = (
    ...rows: [id: string, tokens: number, models?: [string, number][]][]
  ): SiteDay["clients"] =>
    Object.fromEntries(
      rows.map(([id, tokens, models = []]) => [
        id,
        dayClient(
          tokens,
          0,
          Object.fromEntries(
            models.map(([model, value]) => [model, { tokens: value, cost: 0 }]),
          ),
        ),
      ]),
    )

  it("is idle only when nothing at all was recorded", () => {
    const idle = (...daily: SiteDay[]) => dayView(daySite(...daily), TODAY).idle
    expect(idle()).toBe(true)
    expect(idle(day(TODAY, 10))).toBe(false)
    expect(idle(day(TODAY, 0, { messages: 3 }))).toBe(false)
    expect(idle(day(TODAY, 0, { cost: 0.4 }))).toBe(false)
  })

  it("counts CLI-reported active time as activity of its own", () => {
    // Active time is stored and displayed independently of tokens, and a
    // submission carrying only it passes validation — the panel must not
    // answer "nothing logged" while holding a duration.
    const view = dayView(daySite(day(TODAY, 0, { active: 1_800_000 })), TODAY)
    expect(view.idle).toBe(false)
    expect(view.active).toBe(1_800_000)
    // No tokens means no breakdown to draw.
    expect(view.mix).toEqual([])
    expect(view.clients).toEqual([])
  })

  it("reads a past day, not today", () => {
    const view = dayView(
      daySite(day(EVE, 100, { cost: 1 }), day(TODAY, 300, { cost: 3 })),
      EVE,
    )
    expect(view.isLatest).toBe(false)
    expect(view.tokens).toBe(100)
    expect(view.cost).toBe(1)
  })

  it("keeps the top clients and merges the tail into one segment", () => {
    const view = dayView(
      daySite(
        day(TODAY, 100, {
          clients: clients(
            ["claude", 40],
            ["codex", 30],
            ["cursor", 15],
            ["pi", 10],
            ["zed", 3],
            ["gemini", 2],
            ["hermes", 0], // nothing spent: not a segment
          ),
        }),
      ),
      TODAY,
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
    // The cutoff is the ring's alone: the legend names every client that
    // spent anything that day, so nobody is filed under "Other".
    expect(view.clients.map((entry) => entry.id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "pi",
      "zed",
      "gemini",
    ])
    expect(view.clients.map((entry) => entry.share)).toEqual([
      0.4, 0.3, 0.15, 0.1, 0.03, 0.02,
    ])
  })

  it("draws no residual slice when every client has one of its own", () => {
    const view = dayView(
      daySite(
        day(TODAY, 100, { clients: clients(["claude", 60], ["codex", 40]) }),
      ),
      TODAY,
    )
    expect(view.mix.map((entry) => entry.id)).toEqual(["claude", "codex"])
    expect(view.clients.map((entry) => entry.id)).toEqual(["claude", "codex"])
  })

  it("keeps a lone tail client as a slice of its own", () => {
    const view = dayView(
      daySite(
        day(TODAY, 100, {
          clients: clients(
            ["claude", 40],
            ["codex", 30],
            ["cursor", 15],
            ["pi", 10],
            ["zed", 5],
          ),
        }),
      ),
      TODAY,
    )
    expect(view.mix.map((entry) => entry.id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "pi",
      "zed",
    ])
  })

  it("labels client ids that shadow Object members as themselves", () => {
    // Client ids come off the wire unconstrained; a plain-object label
    // table would answer `constructor` with a native function, and the
    // legend would print its source text.
    const view = dayView(
      daySite(
        day(TODAY, 10, {
          clients: clients(["constructor", 6], ["__proto__", 4]),
        }),
      ),
      TODAY,
    )
    expect(view.clients.map((entry) => entry.label)).toEqual([
      "constructor",
      "__proto__",
    ])
  })

  it("carries each client's models, the merged-out ones included", () => {
    const view = dayView(
      daySite(
        day(TODAY, 100, {
          clients: clients(
            [
              "claude",
              60,
              [
                ["claude-opus-5", 40],
                ["deepseek-v4-flash", 20],
              ],
            ],
            ["codex", 20, [["gpt-5.6-sol", 20]]],
            ["cursor", 10, [["composer-2", 10]]],
            ["pi", 6, [["gpt-5.6-luna", 6]]],
            ["zed", 2, [["claude-sonnet-5", 2]]],
            ["gemini", 2, [["gemini-3-pro", 2]]],
          ),
        }),
      ),
      TODAY,
    )
    expect(view.clients[0].models.map((cell) => cell.model)).toEqual([
      "claude-opus-5",
      "deepseek-v4-flash",
    ])
    // Zed is past the ring's cutoff and inside the residual slice, but
    // its legend row still opens onto the model it drove.
    expect(view.clients.find((entry) => entry.id === "zed")).toMatchObject({
      models: [{ model: "claude-sonnet-5", tokens: 2 }],
    })
    // The residual slice is several clients at once, so it is a width and
    // a share and nothing else — there is no disclosure to hang on it.
    expect(view.mix.at(-1)).toMatchObject({ id: "other", tokens: 4 })
  })

  // A row reading "Other" answers no question, so unattributed usage is
  // left out here the same way it is left out of the breakdown lists and
  // the stacks — even when, as here, it would have topped the list.
  it("drops unattributed clients from the mix and the legend", () => {
    const view = dayView(
      daySite(
        day(TODAY, 100, {
          clients: clients(["unknown", 50], ["claude", 30], ["codex", 20]),
        }),
      ),
      TODAY,
    )
    expect(view.clients.map((entry) => entry.id)).toEqual(["claude", "codex"])
    // The trade is that the shares no longer sum to the day.
    expect(view.mix.map((entry) => entry.share)).toEqual([0.3, 0.2])
  })
})

describe("computeFacts", () => {
  it("returns empty facts for an empty series", () => {
    expect(computeFacts([])).toEqual({
      biggest: null,
      busiestWeek: null,
      median: null,
      weekday: null,
      longest: null,
      previous: null,
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

  it("sets a record current streak against the longest before it", () => {
    const facts = computeFacts([
      day("2026-07-01", 1),
      day("2026-07-02", 1),
      day("2026-07-03", 0),
      day("2026-07-04", 1),
      day("2026-07-05", 1),
      day("2026-07-06", 1),
    ])
    expect(facts.current).toEqual({
      length: 3,
      since: "2026-07-04",
      record: true,
    })
    expect(facts.previous).toEqual({
      length: 2,
      from: "2026-07-01",
      to: "2026-07-02",
    })
    expect(facts.longest?.from).toBe("2026-07-04")
  })

  it("keeps an earlier, longer run as the record", () => {
    const facts = computeFacts([
      day("2026-07-01", 1),
      day("2026-07-02", 1),
      day("2026-07-03", 1),
      day("2026-07-04", 0),
      day("2026-07-05", 1),
    ])
    expect(facts.current?.record).toBe(false)
    expect(facts.previous).toEqual(facts.longest)
    expect(facts.longest?.length).toBe(3)
  })

  it("forgives only a idle today for the current streak", () => {
    const active = [
      day("2026-07-17", 1),
      day("2026-07-18", 2),
      day("2026-07-19", 3),
    ]
    const idleToday = computeFacts([...active, day("2026-07-20", 0)])
    expect(idleToday.current).toEqual({
      length: 3,
      since: "2026-07-17",
      record: true,
    })

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

it("uses reported vendors for new model names and leaves ambiguous attribution neutral", () => {
  const range = rangeStats(
    [],
    [],
    [
      { ...usage(), ...span, model: "future-model", providers: ["anthropic"] },
      { ...usage(), ...span, model: "claude-custom", providers: ["google"] },
      {
        ...usage(),
        ...span,
        model: "ambiguous",
        providers: ["openai", "google"],
      },
      { ...usage(), ...span, model: "unknown-vendor", providers: ["unknown"] },
      { ...usage(), ...span, model: "__proto__", providers: ["openai"] },
    ],
  )
  expect(
    stackPaint(
      { dim: "model", ids: range.byModel.map((row) => row.model) },
      modelVendors(range),
    ),
  ).toEqual([
    { p: "anthropic", shade: 0 },
    { p: "google", shade: 0 },
    { p: "other", shade: 1 },
    { p: "other", shade: 2 },
    { p: "openai", shade: 0 },
  ])
})
