import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { logoSvg, recentLevels } from "./live-logo"

const day = (date: string, tokens: number) => ({ date, tokens }) as never

describe("logoSvg", () => {
  it("draws the committed logo by default", () => {
    expect(logoSvg()).toBe(readFileSync("src/assets/logo.svg", "utf8"))
  })

  it("inks each cell by its level, the top-left always full", () => {
    const svg = logoSvg([0, 2, 4])
    const opacities = [
      ...svg.matchAll(/<rect[^>]*?(?:opacity="([^"]+)")?\/>/g),
    ].map((m) => m[1] ?? "1")
    expect(opacities).toEqual(["1", ".32", ".58", "1"])
  })
})

describe("recentLevels", () => {
  // Quartiles of the active days here are 200, 300 and 400.
  it("reads the three days ending today, a missing day as empty", () => {
    const daily = [
      day("2026-10-01", 100),
      day("2026-10-02", 200),
      day("2026-10-03", 300),
      day("2026-10-04", 400),
      day("2026-10-06", 400),
    ]
    expect(recentLevels({ today: "2026-10-06", daily })).toEqual([3, 0, 3])
    expect(recentLevels({ today: "2026-10-03", daily })).toEqual([1, 1, 2])
  })
})
