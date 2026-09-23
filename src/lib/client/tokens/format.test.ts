import { describe, expect, it } from "bun:test"
import {
  formatDelta,
  formatIn,
  formatRemaining,
  formatShare,
  isOnline,
  shiftDays,
} from "./format"

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

describe("formatIn", () => {
  const now = Date.parse("2026-07-20T12:00:00Z")
  const at = (iso: string) => formatIn(Date.parse(iso), now)

  it("counts down in two units, dropping a zero second one", () => {
    expect(at("2026-07-20T12:40:00Z")).toBe("in 40m")
    expect(at("2026-07-20T13:08:00Z")).toBe("in 1h 8m")
    expect(at("2026-07-20T15:00:00Z")).toBe("in 3h")
    expect(at("2026-07-22T16:00:00Z")).toBe("in 2d 4h")
    expect(at("2026-07-22T12:00:00Z")).toBe("in 2d")
  })

  // A deadline rounded up hands the reader time they do not have: a
  // credit lapsing in five and a half days must not read "in 6d".
  it("rounds down, never up", () => {
    expect(at("2026-07-26T01:08:00Z")).toBe("in 5d 13h")
    expect(at("2026-07-20T15:59:30Z")).toBe("in 3h 59m")
    expect(at("2026-07-20T12:59:00Z")).toBe("in 59m")
  })

  it("never reads as expired while it still has seconds left", () => {
    expect(at("2026-07-20T12:00:30Z")).toBe("in 1m")
  })

  it("returns null once the instant has passed", () => {
    expect(at("2026-07-20T11:59:00Z")).toBeNull()
    expect(at("2026-07-20T12:00:00Z")).toBeNull()
    expect(at("2026-07-19T12:00:00Z")).toBeNull()
  })
})

describe("formatRemaining", () => {
  it("is formatIn without the preposition", () => {
    const now = Date.parse("2026-07-20T12:00:00Z")
    expect(formatRemaining(Date.parse("2026-07-31T07:00:00Z"), now)).toBe(
      "10d 19h",
    )
    expect(formatRemaining(now, now)).toBeNull()
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

it("ages device reports using the collector's threshold, including the boundary", () => {
  const now = 10_000
  expect(isOnline(null, 1000, now)).toBe(false)
  expect(isOnline(now - 999, 1000, now)).toBe(true)
  expect(isOnline(now - 1000, 1000, now)).toBe(false)
  expect(isOnline(now - 1000, 2000, now)).toBe(true)
})
