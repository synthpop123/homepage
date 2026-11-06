/**
 * A squarified treemap, small enough to keep in-house: d3-hierarchy's
 * `treemapSquarify` (Bruls, Huizing and van Wijk) over a flat list of
 * values, in the order given, plus the gap between neighbours. Pure, and
 * in pixels: the caller hands it the frame it draws into.
 */

export type Rect = { x0: number; y0: number; x1: number; y1: number }

/** d3's default: rows whose cells are about golden rectangles. */
const PHI = (1 + Math.sqrt(5)) / 2

/** Cells laid side by side across a row, by value. */
function dice(values: number[], total: number, rect: Rect, out: Rect[]) {
  const k = total ? (rect.x1 - rect.x0) / total : 0
  let x = rect.x0
  for (const value of values) {
    out.push({ x0: x, y0: rect.y0, x1: (x += value * k), y1: rect.y1 })
  }
}

/** Cells stacked down a column, by value. */
function slice(values: number[], total: number, rect: Rect, out: Rect[]) {
  const k = total ? (rect.y1 - rect.y0) / total : 0
  let y = rect.y0
  for (const value of values) {
    out.push({ x0: rect.x0, y0: y, x1: rect.x1, y1: (y += value * k) })
  }
}

/**
 * One rectangle per value, filling `frame`, each with an area in
 * proportion to its value. The order is kept: put the largest first.
 */
export function squarify(values: number[], frame: Rect, ratio = PHI): Rect[] {
  const out: Rect[] = []
  const n = values.length
  let { x0, y0, x1, y1 } = frame
  let rest = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  let i0 = 0
  let i1 = 0
  while (i0 < n) {
    const dx = x1 - x0
    const dy = y1 - y0
    // The next value that has any area.
    let sum = 0
    do sum = Math.max(0, values[i1++])
    while (!sum && i1 < n)
    let min = sum
    let max = sum
    const alpha = Math.max(dy / dx, dx / dy) / (rest * ratio)
    let beta = sum * sum * alpha
    let worst = Math.max(max / beta, beta / min)
    // Grow the row while its worst aspect ratio holds or improves.
    for (; i1 < n; ++i1) {
      const value = Math.max(0, values[i1])
      sum += value
      if (value < min) min = value
      if (value > max) max = value
      beta = sum * sum * alpha
      const next = Math.max(max / beta, beta / min)
      if (next > worst) {
        sum -= value
        break
      }
      worst = next
    }
    const row = values.slice(i0, i1).map((value) => Math.max(0, value))
    if (dx < dy) {
      const y = rest ? y0 + (dy * sum) / rest : y1
      dice(row, sum, { x0, y0, x1, y1: y }, out)
      y0 = y
    } else {
      const x = rest ? x0 + (dx * sum) / rest : x1
      slice(row, sum, { x0, y0, x1: x, y1 }, out)
      x0 = x
    }
    rest -= sum
    i0 = i1
  }
  return out
}

/**
 * Whole-pixel cells with `gap` between neighbours: every edge is rounded,
 * then each edge inside `frame` gives up its half of the gap, so the outer
 * edges stay on the frame and every gap is the same.
 */
export function inset(rects: Rect[], frame: Rect, gap: number): Rect[] {
  const lead = Math.ceil(gap / 2)
  const trail = Math.floor(gap / 2)
  const inside = (edge: number, bound: number) => Math.abs(edge - bound) > 0.5
  return rects.map((rect) => {
    const x0 = Math.round(rect.x0)
    const y0 = Math.round(rect.y0)
    const x1 = Math.round(rect.x1)
    const y1 = Math.round(rect.y1)
    const left = inside(x0, frame.x0) ? x0 + lead : x0
    const top = inside(y0, frame.y0) ? y0 + lead : y0
    const right = inside(x1, frame.x1) ? x1 - trail : x1
    const bottom = inside(y1, frame.y1) ? y1 - trail : y1
    return {
      x0: left,
      y0: top,
      x1: Math.max(left, right),
      y1: Math.max(top, bottom),
    }
  })
}
