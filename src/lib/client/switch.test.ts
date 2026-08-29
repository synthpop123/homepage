import { describe, expect, it } from "bun:test"
import {
  formatPlaytime,
  heatmapWindow,
  isSite,
  SITE_SCHEMA_VERSION,
} from "./switch"
import fixture from "./switch.site-fixture.json"

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

  it("rejects a payload missing a field the renderer reads", () => {
    const { recentDays, ...rest } = fixture
    expect(isSite(rest)).toBe(false)
    expect(isSite({ ...fixture, games: [{ title: "No id" }] })).toBe(false)
  })
})

describe("heatmapWindow", () => {
  const activity = [
    { date: "2026-08-28", minutes: 65 },
    { date: "2026-08-29", minutes: 40 },
  ]

  it("pads a short series out to a full grid ending today", () => {
    const days = heatmapWindow(activity, "2026-08-29", 5)
    expect(days).toEqual([
      { date: "2026-08-25", minutes: 0 },
      { date: "2026-08-26", minutes: 0 },
      { date: "2026-08-27", minutes: 0 },
      { date: "2026-08-28", minutes: 65 },
      { date: "2026-08-29", minutes: 40 },
    ])
  })

  it("drops days past the end of the window", () => {
    const days = heatmapWindow(activity, "2026-08-28", 2)
    expect(days.map((day) => day.date)).toEqual(["2026-08-27", "2026-08-28"])
  })

  it("crosses month boundaries", () => {
    expect(heatmapWindow([], "2026-09-01", 2)[0].date).toBe("2026-08-31")
  })
})

describe("formatPlaytime", () => {
  it("drops the hour below 60 minutes and the minutes on the hour", () => {
    expect(formatPlaytime(0)).toBe("0m")
    expect(formatPlaytime(45)).toBe("45m")
    expect(formatPlaytime(60)).toBe("1h")
    expect(formatPlaytime(65)).toBe("1h 5m")
    expect(formatPlaytime(1_500)).toBe("25h")
  })
})
