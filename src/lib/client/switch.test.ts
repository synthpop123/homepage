import { describe, expect, it } from "bun:test"
import {
  formatPlaytime,
  heatmapWindow,
  isSite,
  lastPlayedLabel,
  rowFoot,
  SITE_SCHEMA_VERSION,
  type SiteGame,
  statCards,
} from "./switch"
import fixture from "./switch.site-fixture.json"

const game = (
  totalMinutes: number,
  recentMinutes: number,
  lastPlayedDate: string | null = "2026-08-29",
): SiteGame => ({
  applicationId: `G${totalMinutes}`,
  title: "Game",
  imageUrl: null,
  shopUrl: null,
  totalMinutes,
  recentMinutes,
  lastPlayedDate,
})

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

describe("lastPlayedLabel", () => {
  it("counts days back from the payload's own today", () => {
    expect(lastPlayedLabel("2026-08-29", "2026-08-29")).toBe("Today")
    expect(lastPlayedLabel("2026-08-28", "2026-08-29")).toBe("Yesterday")
    expect(lastPlayedLabel("2026-07-30", "2026-08-29")).toBe("30 days ago")
  })

  it("says nothing without a day, or for one that hasn't happened", () => {
    expect(lastPlayedLabel(null, "2026-08-29")).toBeNull()
    expect(lastPlayedLabel("2026-08-30", "2026-08-29")).toBeNull()
  })
})

describe("statCards", () => {
  const stats = {
    totalMinutes: 375,
    gameCount: 6,
    daysActive: 3,
    daysTracked: 3,
    avgDailyMinutes: 125,
    longestStreak: 3,
    currentStreak: 3,
    firstDate: "2026-08-28",
    lastPlayedDate: "2026-08-30",
    libraryValueCny: 1384,
    pricedGameCount: 4,
  }

  it("values the library when prices exist, and says how many titles back it", () => {
    const [playtime, games, third, perDay] = statCards(stats)
    expect(playtime).toEqual({ label: "Playtime", value: "6h 15m", note: "" })
    expect(games).toEqual({ label: "Games", value: "6", note: "" })
    expect(third.label).toBe("Library value")
    expect(third.value).toBe("¥1,384")
    expect(third.note).toBe("CNY, at eShop list price for 4 of 6 titles")
    expect(perDay).toEqual({
      label: "Per active day",
      value: "2h 5m",
      note: "",
    })
  })

  it("admits when every title is priced", () => {
    const [, , third] = statCards({
      ...stats,
      libraryValueCny: 1384,
      pricedGameCount: stats.gameCount,
    })
    expect(third.note).toBe("CNY, at eShop list price for every title played")
  })

  it("falls back to days active — with an empty note — once the prices are gone", () => {
    const [, , third] = statCards({
      ...stats,
      libraryValueCny: null,
      pricedGameCount: 0,
    })
    expect(third).toEqual({ label: "Days active", value: "3", note: "" })
  })
})

describe("rowFoot", () => {
  it("adds the recent clause only when it is less than the whole", () => {
    expect(rowFoot(game(100, 100), 14, "2026-08-29")).toBe("Today")
    expect(rowFoot(game(100, 40), 14, "2026-08-29")).toBe(
      "Today, 40m in 2 weeks",
    )
    expect(rowFoot(game(100, 40), 10, "2026-08-29")).toBe(
      "Today, 40m in 10 days",
    )
    expect(rowFoot(game(100, 0), 14, "2026-08-29")).toBe("Today")
  })

  it("reads as an empty line when nothing is known", () => {
    expect(rowFoot(game(100, 0, null), 14, "2026-08-29")).toBe("")
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
