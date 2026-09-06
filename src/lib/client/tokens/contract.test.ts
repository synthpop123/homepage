import { describe, expect, it } from "bun:test"
import {
  computeFacts,
  dailyBuckets,
  fillDaily,
  modelVendors,
  type StackDim,
  stackFor,
  stackPaint,
  todayView,
} from "./aggregate"
import { isSite, RANGE_KEYS, SITE_SCHEMA_VERSION } from "./schema"
import fixture from "../tokens.site-fixture.json"

describe("/api/site fixture contract", () => {
  // Captured /api/site payload; producer-side assertions live in
  // tokens-worker/test/site.spec.ts.
  it("passes the strict decoder", () => {
    // Recapture the fixture from the live endpoint (never hand-edit it)
    // when tokens-worker bumps SITE_VERSION.
    expect(fixture.schemaVersion).toBe(SITE_SCHEMA_VERSION)
    expect(isSite(fixture)).toBe(true)
  })

  // The one reported field, so it is also the one that can be silently
  // stale — the renderer needs `capturedAt` to be arithmetic, not a
  // label, and a plan with no windows would draw a heading over nothing.
  it("carries a decodable quota plan per subscription", () => {
    if (!isSite(fixture)) throw new Error("fixture failed decoding")
    for (const plan of fixture.quota) {
      expect(Number.isFinite(Date.parse(plan.capturedAt))).toBe(true)
      expect(plan.windows.length).toBeGreaterThan(0)
      for (const window of plan.windows) {
        expect(window.usedPercent).toBeGreaterThanOrEqual(0)
        expect(window.usedPercent).toBeLessThanOrEqual(100)
      }
      // Reset credits are instants the renderer compares against now.
      for (const at of plan.resetCredits) {
        expect(Number.isFinite(Date.parse(at))).toBe(true)
      }
    }
    // Each provider appears once — the renderer draws one card each.
    const providers = fixture.quota.map((plan) => plan.provider)
    expect(new Set(providers).size).toBe(providers.length)
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
    // The mix apportions the whole day, whatever the client count — and
    // the legend, which is not capped, apportions the same day.
    expect(view.mix.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(
      view.totals.tokens,
    )
    expect(view.clients.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(
      view.totals.tokens,
    )
  })

  it("feeds the render paths the dashboard actually runs", () => {
    if (!isSite(fixture)) throw new Error("fixture failed decoding")
    const dims: StackDim[] = ["provider", "client", "model"]
    for (const dim of dims) {
      const stack = stackFor(fixture.ranges.all, dim, "tokens")
      expect(stack.ids.length).toBeGreaterThan(1)
      expect(stackPaint(stack, modelVendors(fixture.ranges.all))).toHaveLength(
        stack.ids.length,
      )
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
