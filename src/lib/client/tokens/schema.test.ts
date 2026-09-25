import { describe, expect, it } from "bun:test"
import {
  DEFAULT_RANGE,
  isSite,
  type RangeKey,
  RANGES,
  rangeMeta,
  type Site,
  SITE_SCHEMA_VERSION,
  type SiteDay,
} from "./schema"
import {
  day,
  dayClient,
  usage,
  span,
  device,
  providerRows,
  site,
  quotaPlan,
} from "./test-helpers"

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

  // Quota is a list, empty until a collector has reported, but not
  // loose: it is reported data and the renderer does arithmetic on every
  // instant in it.
  it("accepts an empty quota list but not a malformed one", () => {
    expect(isSite({ ...site(), quota: [] })).toBe(true)
    expect(isSite({ ...site(), quota: [quotaPlan()] })).toBe(true)

    // A bare plan where a list belongs, and the shapes schema 11 used.
    for (const quotaValue of [
      undefined,
      null,
      "yes",
      quotaPlan(),
      { capturedAt: "2026-07-20T00:00:00Z", plans: [] },
    ]) {
      expect(isSite({ ...site(), quota: quotaValue })).toBe(false)
    }
  })

  // capturedAt is per plan: each is read by its own collector on its own
  // timer, and its card is aged by it, so a decorative string there is
  // the failure worth catching — it decides whether numbers that may
  // describe an ended window are presented as current.
  it("requires every plan to date itself", () => {
    for (const capturedAt of [undefined, null, "recently", 1_753_000_000_000]) {
      expect(
        isSite({ ...site(), quota: [{ ...quotaPlan(), capturedAt }] }),
      ).toBe(false)
    }
  })

  it("rejects a quota plan the renderer could not draw", () => {
    const withPlan = (patch: Record<string, unknown>) => ({
      ...site(),
      quota: [{ ...quotaPlan(), ...patch }],
    })
    // A plan with no windows is a heading over nothing.
    expect(isSite(withPlan({ windows: [] }))).toBe(false)
    expect(isSite(withPlan({ provider: undefined }))).toBe(false)
    expect(isSite(withPlan({ resetCredits: [1, 2] }))).toBe(false)
    // Schema 14's bare expiry strings.
    expect(isSite(withPlan({ resetCredits: ["2026-07-25T00:00:00Z"] }))).toBe(
      false,
    )
    expect(isSite(withPlan({ allowances: undefined }))).toBe(false)
    // The allowance gauge divides by its limit.
    const allowance = {
      label: "Cloud session credits",
      usedDollars: 0,
      limitDollars: 100,
      resetsAt: null,
    }
    expect(isSite(withPlan({ allowances: [allowance] }))).toBe(true)
    expect(
      isSite(withPlan({ allowances: [{ ...allowance, limitDollars: 0 }] })),
    ).toBe(false)
    expect(isSite(withPlan({ extraUsage: null }))).toBe(true)
    expect(isSite(withPlan({ extraUsage: { enabled: "no" } }))).toBe(false)
    // A null plan tier is fine — not every subscription names one.
    expect(isSite(withPlan({ plan: null }))).toBe(true)

    const badWindow = (patch: Record<string, unknown>) =>
      withPlan({
        windows: [
          {
            label: "Weekly",
            usedPercent: 28,
            resetsAt: null,
            breakdown: [],
            ...patch,
          },
        ],
      })
    expect(isSite(badWindow({}))).toBe(true)
    expect(isSite(badWindow({ usedPercent: "28" }))).toBe(false)
    expect(isSite(badWindow({ resetsAt: "soon" }))).toBe(false)
  })

  // The day panel expands a day's clients into the models behind them,
  // so that join is part of the schema: a client without its models is a
  // rejection, not a shrug.
  it("requires the per-day client × model join", () => {
    const withModels = site()
    withModels.daily = [
      day("2026-07-20", 5, {
        clients: {
          "claude-code": dayClient(5, 1, {
            "claude-opus-5": { tokens: 5, cost: 1 },
          }),
        },
      }),
    ]
    expect(isSite(withModels)).toBe(true)

    const withoutModels = site()
    withoutModels.daily = [
      {
        ...day("2026-07-20", 5),
        clients: { "claude-code": { tokens: 5, cost: 1 } },
      },
    ] as unknown as SiteDay[]
    expect(isSite(withoutModels)).toBe(false)

    const badModels = site()
    badModels.daily = [
      {
        ...day("2026-07-20", 5),
        clients: {
          "claude-code": {
            tokens: 5,
            cost: 1,
            models: { "claude-opus-5": { tokens: "5" } },
          },
        },
      },
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

    const badSpan = site(providerRows(["anthropic", 10]))
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
      { ...usage(10), provider: "anthropic", models: [] },
    ])
    expect(isSite(spanless)).toBe(false)

    const namelessDevice = site()
    namelessDevice.devices = [{ activeDays: 1 } as Site["devices"][number]]
    expect(isSite(namelessDevice)).toBe(false)
  })

  // The model cells (on client rows since schema 9, on provider rows
  // since 10) and the model rows' provider arrays are read straight into
  // a renderer — the cells into a disclosure, the providers into a
  // .join() — so a wrong type here is a crash, not a blank.
  it("requires model cells on client and provider rows", () => {
    const models = [{ model: "claude-opus-5", tokens: 5, cost: 1, messages: 2 }]
    const good = site(
      [{ ...usage(5), ...span, provider: "anthropic", models }],
      [{ ...usage(5), ...span, client: "claude", models }],
    )
    expect(isSite(good)).toBe(true)

    for (const broken of [
      // @ts-expect-error deliberately breaking the shape
      site([], [{ ...usage(5), ...span, client: "claude" }]),
      // @ts-expect-error deliberately breaking the shape
      site([{ ...usage(5), ...span, provider: "anthropic" }]),
      site(
        [],
        // @ts-expect-error deliberately breaking the shape
        [{ ...usage(5), ...span, client: "claude", models: [{ model: "m" }] }],
      ),
    ]) {
      expect(isSite(broken)).toBe(false)
    }

    // The pre-9 encoding: a comma-joined string would reach .filter().
    const joined = site()
    joined.ranges.all.byModel = [
      // @ts-expect-error deliberately breaking the shape
      { ...usage(5), ...span, model: "m", providers: "anthropic,openai" },
    ]
    expect(isSite(joined)).toBe(false)
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

it("rejects missing or invalid device freshness thresholds", () => {
  for (const deviceOnlineWithinMs of [
    undefined,
    null,
    "2700000",
    0,
    -1,
    Infinity,
    NaN,
  ]) {
    expect(isSite({ ...site(), deviceOnlineWithinMs })).toBe(false)
  }
})

it("keeps selector defaults and unknown-range fallback together", () => {
  expect(RANGES.filter((entry) => entry.default)).toHaveLength(1)
  // A control persisted by an older build names a range that is gone.
  expect(rangeMeta("day" as RangeKey)).toBe(DEFAULT_RANGE)
  expect(rangeMeta(DEFAULT_RANGE.key)).toBe(DEFAULT_RANGE)
})
