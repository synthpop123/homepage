import { describe, expect, it } from "bun:test"
import {
  flightFoot,
  flightTitle,
  flownLabel,
  isSite,
  SITE_SCHEMA_VERSION,
  tokensFoot,
  tokensLabel,
  watchedLabel,
} from "./now"
import fixture from "./now.site-fixture.json"

describe("isSite", () => {
  it("accepts the pinned production fixture", () => {
    expect(isSite(fixture)).toBe(true)
    expect(fixture.schemaVersion).toBe(SITE_SCHEMA_VERSION)
  })

  it("accepts a source with nothing to show", () => {
    expect(
      isSite({
        ...fixture,
        listen: null,
        film: null,
        tokens: null,
        flight: null,
      }),
    ).toBe(true)
  })

  it("rejects another schema version, a non-http link and a bad flight", () => {
    expect(isSite({ ...fixture, schemaVersion: SITE_SCHEMA_VERSION + 1 })).toBe(
      false,
    )
    const listen = { ...fixture.listen, url: "javascript:alert(1)" }
    expect(isSite({ ...fixture, listen })).toBe(false)
    const flight = { ...fixture.flight, date: "Aug 16" }
    expect(isSite({ ...fixture, flight })).toBe(false)
    expect(
      isSite({ ...fixture, flight: { ...fixture.flight, from: "JNH" } }),
    ).toBe(false)
  })
})

describe("watchedLabel", () => {
  it("speaks in calendar days", () => {
    expect(watchedLabel("2026-09-27", "2026-09-27")).toBe("today")
    expect(watchedLabel("2026-09-26", "2026-09-27")).toBe("yesterday")
    expect(watchedLabel("2026-09-22", "2026-09-27")).toBe("5d ago")
    expect(watchedLabel("2026-09-02", "2026-09-27")).toBe("Sep 2")
  })
})

describe("tokensLabel", () => {
  it("claims today only for today's payload", () => {
    expect(tokensLabel("2026-09-27", "2026-09-27")).toBe("Tokens today")
    expect(tokensLabel("2026-09-26", "2026-09-27")).toBe("Tokens yesterday")
    expect(tokensLabel("2026-09-20", "2026-09-27")).toBe("Tokens · Sep 20")
  })
})

describe("tile text", () => {
  it("sums up today's tokens under the figure", () => {
    expect(tokensFoot({ tokens: 1, cost: 14.482494, messages: 155 })).toEqual([
      "$14.48",
      "155 messages",
    ])
    expect(tokensFoot({ tokens: 0, cost: 0, messages: 1 })).toEqual([
      "$0.00",
      "1 message",
    ])
  })

  const flight = {
    date: "2026-08-16",
    from: { code: "JNH", city: "Jiaxing" },
    to: { code: "PEK", city: "Beijing" },
    km: 1106,
    minutes: 135,
    airline: "Air China",
    aircraft: "Airbus A321",
  }

  it("names the last flight's day, the year only when it is another", () => {
    expect(flownLabel("2026-08-16", "2026-09-27")).toBe("Aug 16")
    expect(flownLabel("2025-12-30", "2026-01-02")).toBe("Dec 30, 2025")
  })

  it("puts the cities and the distance under the codes, the rest in the tooltip", () => {
    expect(flightFoot(flight)).toEqual(["Jiaxing → Beijing", "1,106 km"])
    expect(
      flightFoot({ ...flight, from: { code: "JNH", city: null } })[0],
    ).toBe("JNH → Beijing")
    expect(flightTitle(flight)).toBe(
      "Jiaxing → Beijing\nAug 16, 2026 · 1,106 km · 2h 15m · Air China, Airbus A321",
    )
    expect(
      flightTitle({ ...flight, minutes: null, airline: null, aircraft: null }),
    ).toBe("Jiaxing → Beijing\nAug 16, 2026 · 1,106 km")
  })
})
