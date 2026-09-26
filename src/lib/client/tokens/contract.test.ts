import { describe, expect, it } from "bun:test"
import {
  computeFacts,
  dailyBuckets,
  dayView,
  fillDaily,
  modelVendors,
  type StackDim,
  stackFor,
  stackPaint,
} from "./aggregate"
import { isSite, RANGE_KEYS, SITE_SCHEMA_VERSION } from "./schema"
import fixture from "../tokens.site-fixture.json"

describe("/tokens/site fixture contract", () => {
  // Captured /tokens/site payload; producer-side assertions live in
  // cf-workers-api/test/tokens/site.spec.ts.
  it("passes the strict decoder", () => {
    // Recapture the fixture from the live endpoint (never hand-edit it)
    // when cf-workers-api bumps the tokens SITE_VERSION.
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
      for (const credit of plan.resetCredits) {
        expect(Number.isFinite(Date.parse(credit.expiresAt))).toBe(true)
      }
      // An allowance is a gauge: spend against a positive ceiling.
      for (const allowance of plan.allowances) {
        expect(allowance.limitDollars).toBeGreaterThan(0)
        expect(allowance.usedDollars).toBeGreaterThanOrEqual(0)
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
    // the dashboard draws ends today, and the day panel's active time is
    // matched by exact date — a row past `today` would be unreachable
    // from the heatmap while still counting in every range.
    for (const day of fixture.daily) {
      expect(day.date <= fixture.today).toBe(true)
    }
    for (const key of RANGE_KEYS) {
      const { totals } = fixture.ranges[key]
      expect(totals.lastDate === null || totals.lastDate <= fixture.today).toBe(
        true,
      )
    }
  })

  // Today and any day the visitor clicks are one code path, so the
  // fixture has to prove both ends of it.
  it("opens today and a past day off the same daily series", () => {
    if (!isSite(fixture)) throw new Error("fixture failed decoding")
    const busiest = [...fixture.daily].sort((a, b) => b.tokens - a.tokens)[0]

    for (const date of [fixture.today, busiest.date]) {
      const view = dayView(fixture, date)
      const day = fixture.daily.find((entry) => entry.date === date)
      expect(view.isToday).toBe(date === fixture.today)
      expect(view.idle).toBe(false)
      expect(view.tokens).toBe(day?.tokens ?? 0)
      expect(view.messages).toBe(day?.messages ?? 0)
      expect(view.cost).toBeCloseTo(day?.cost ?? 0, 6)
      // The bar apportions the day whatever the client count, and the
      // legend — which is not capped — apportions the same day.
      const named = view.clients.reduce((sum, entry) => sum + entry.tokens, 0)
      expect(view.mix.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(named)
      // Every client opens onto the models behind it, and those sum back
      // to the client.
      for (const client of view.clients) {
        const models = client.models.reduce((sum, cell) => sum + cell.tokens, 0)
        expect(models).toBe(client.tokens)
      }
    }
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
