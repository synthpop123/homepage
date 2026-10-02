import { describe, expect, it } from "bun:test"
import { stepDay } from "./heatmap"

describe("stepDay", () => {
  const first = "2025-09-29"
  const last = "2026-09-28"

  it("moves along the grid's axes: rows are days, columns weeks", () => {
    expect(stepDay("2026-09-20", "ArrowUp", first, last)).toBe("2026-09-19")
    expect(stepDay("2026-09-20", "ArrowDown", first, last)).toBe("2026-09-21")
    expect(stepDay("2026-09-20", "ArrowLeft", first, last)).toBe("2026-09-13")
    expect(stepDay("2026-09-20", "ArrowRight", first, last)).toBe("2026-09-27")
  })

  it("crosses month and year boundaries", () => {
    expect(stepDay("2026-03-01", "ArrowUp", first, last)).toBe("2026-02-28")
    expect(stepDay("2025-12-29", "ArrowRight", first, last)).toBe("2026-01-05")
  })

  it("stays put at either end", () => {
    expect(stepDay(first, "ArrowUp", first, last)).toBe(first)
    expect(stepDay("2025-10-02", "ArrowLeft", first, last)).toBe("2025-10-02")
    expect(stepDay(last, "ArrowDown", first, last)).toBe(last)
    expect(stepDay("2026-09-22", "ArrowRight", first, last)).toBe("2026-09-22")
  })

  it("returns to today on Home and ignores other keys", () => {
    expect(stepDay("2026-01-01", "Home", first, last)).toBe(last)
    expect(stepDay("2026-01-01", "Enter", first, last)).toBeNull()
  })
})
