import { describe, expect, it } from "bun:test"
import { inset, type Rect, squarify } from "./treemap"

const area = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0)
const frame: Rect = { x0: 0, y0: 0, x1: 600, y1: 300 }

describe("squarify", () => {
  it("gives each value its share of the frame, in order", () => {
    const values = [6, 3, 2, 1]
    const rects = squarify(values, frame)
    expect(rects).toHaveLength(4)
    rects.forEach((rect, i) => {
      expect(area(rect)).toBeCloseTo((values[i] / 12) * area(frame), 6)
      expect(rect.x0).toBeGreaterThanOrEqual(0)
      expect(rect.y1).toBeLessThanOrEqual(300 + 1e-9)
    })
  })

  it("fills the frame with a single value", () => {
    expect(squarify([5], frame)).toEqual([frame])
  })

  it("keeps a zero as an empty cell", () => {
    const rects = squarify([1, 0, 1], frame)
    expect(rects).toHaveLength(3)
    expect(area(rects[1])).toBe(0)
  })

  it("keeps cells square at a ratio of 1", () => {
    const rects = squarify([1, 1, 1, 1], { x0: 0, y0: 0, x1: 200, y1: 200 }, 1)
    for (const rect of rects) {
      const ratio = (rect.x1 - rect.x0) / (rect.y1 - rect.y0)
      expect(ratio).toBeCloseTo(1, 6)
    }
  })
})

describe("inset", () => {
  it("leaves the outer edges on the frame and an even gap inside", () => {
    const rects = inset(
      [
        { x0: 0, y0: 0, x1: 300.4, y1: 300 },
        { x0: 300.4, y0: 0, x1: 600, y1: 300 },
      ],
      frame,
      3,
    )
    expect(rects[0]).toEqual({ x0: 0, y0: 0, x1: 299, y1: 300 })
    expect(rects[1]).toEqual({ x0: 302, y0: 0, x1: 600, y1: 300 })
    expect(rects[1].x0 - rects[0].x1).toBe(3)
  })

  it("never turns a sliver inside out", () => {
    const [rect] = inset([{ x0: 100, y0: 0, x1: 101, y1: 300 }], frame, 3)
    expect(rect.x1).toBeGreaterThanOrEqual(rect.x0)
  })
})
