/**
 * The Portfolio line chart: one ink line (the portfolio's growth index or a
 * holding's closes) over a faint wash, an optional dashed ghost (the
 * benchmark rebased onto the line's start), and a scrubber — a hairline
 * and an accent dot that follow the pointer, or the arrow keys when the
 * chart has focus (it is a slider over the range's days, so the keyboard
 * and screen readers reach every point the pointer does). A holding's
 * line can carry its cost: a dashed level with the gap to it washed green
 * above and grey below, and a dot on the day of the first buy.
 *
 * Drawn to the container's width in pixels each time, so strokes stay
 * one width at any size; the caller redraws on resize.
 */

const SVG_NS = "http://www.w3.org/2000/svg"

const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
) => {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value))
  }
  return node
}

export type ChartSpec = {
  /** The line, one value per point; leading nulls are skipped. */
  values: (number | null)[]
  /** Same length as `values`, already on the line's scale. */
  ghost?: (number | null)[]
  ghostLabel?: string
  /** A level drawn dashed across, the line's gap to it washed by side;
   *  unlabelled, since the caller keys it outside the chart. */
  cost?: number | null
  /** A point marked on the line (the first buy). */
  mark?: number | null
  /** What the slider says for a point: `Oct 21: +12.73%`. */
  describe: (index: number) => string
  /** The date over the scrubber. */
  dateOf: (index: number) => string
  /** Called with the scrubbed point, and with null when it lets go. */
  onScrub?: (index: number | null) => void
  /** Draw the line in from the left (a first paint, a new range). */
  animate?: boolean
}

export type Chart = {
  /** Move the scrubber from outside (the strip under the chart). */
  scrub: (index: number | null) => void
}

const PAD_TOP = 24
const PAD_BOTTOM = 4
const PAD_X = 2

/** Clip-path ids, unique on the page. */
let clipSerial = 0

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches

export function drawChart(svg: SVGSVGElement, spec: ChartSpec): Chart {
  const width = Math.max(svg.clientWidth, 1)
  const height = Math.max(svg.clientHeight, 1)
  const n = spec.values.length
  const shown = [
    ...spec.values,
    ...(spec.ghost ?? []),
    ...(spec.cost == null ? [] : [spec.cost]),
  ].filter((value): value is number => value !== null)
  let lo = Math.min(...shown)
  let hi = Math.max(...shown)
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1
  lo -= pad
  hi += pad

  const x = (i: number) =>
    PAD_X + (n > 1 ? i / (n - 1) : 0.5) * (width - PAD_X * 2)
  const y = (value: number) =>
    PAD_TOP + ((hi - value) / (hi - lo)) * (height - PAD_TOP - PAD_BOTTOM)
  const path = (series: (number | null)[]) => {
    let d = ""
    series.forEach((value, i) => {
      if (value === null) return
      d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(value).toFixed(1)}`
    })
    return d
  }

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
  const first = spec.values.findIndex((value) => value !== null)
  const line = path(spec.values)
  const nodes: SVGElement[] = []

  if (line && first >= 0 && spec.cost != null) {
    // The band between the line and the cost, cut at the cost's level:
    // above it a gain, below it a loss.
    const level = y(spec.cost)
    const id = `cost-${(clipSerial++).toString(36)}`
    const above = svgEl("clipPath", { id: `${id}-up` })
    above.append(svgEl("rect", { x: 0, y: 0, width, height: level }))
    const below = svgEl("clipPath", { id: `${id}-down` })
    below.append(
      svgEl("rect", {
        x: 0,
        y: level,
        width,
        height: Math.max(0, height - level),
      }),
    )
    const defs = svgEl("defs")
    defs.append(above, below)
    const band = `${line}L${x(n - 1).toFixed(1)},${level.toFixed(1)}L${x(first).toFixed(1)},${level.toFixed(1)}Z`
    nodes.push(
      defs,
      svgEl("path", {
        class: "chart-gain",
        d: band,
        "clip-path": `url(#${id}-up)`,
      }),
      svgEl("path", {
        class: "chart-loss",
        d: band,
        "clip-path": `url(#${id}-down)`,
      }),
      svgEl("line", {
        class: "chart-cost",
        x1: 0,
        x2: width,
        y1: level,
        y2: level,
      }),
    )
  } else if (line && first >= 0) {
    nodes.push(
      svgEl("path", {
        class: "chart-area",
        d: `${line}L${x(n - 1).toFixed(1)},${height}L${x(first).toFixed(1)},${height}Z`,
      }),
    )
  }
  if (spec.ghost) {
    const ghost = path(spec.ghost)
    if (ghost) {
      nodes.push(svgEl("path", { class: "chart-ghost", d: ghost }))
      const end = spec.ghost[n - 1]
      const own = spec.values[n - 1]
      if (end !== null && own !== null && spec.ghostLabel) {
        const gy = y(end)
        const label = svgEl("text", {
          class: "chart-ghost-label",
          x: width - PAD_X,
          // Beside its own line, on the side away from the portfolio's.
          y: gy > y(own) ? Math.min(height - 2, gy + 14) : Math.max(10, gy - 7),
          "text-anchor": "end",
        })
        label.textContent = spec.ghostLabel
        nodes.push(label)
      }
    }
  }
  const stroke = svgEl("path", { class: "chart-line", d: line })
  nodes.push(stroke)
  const marked = spec.mark == null ? null : spec.values[spec.mark]
  if (spec.mark != null && marked != null) {
    nodes.push(
      svgEl("circle", {
        class: "chart-mark",
        cx: x(spec.mark).toFixed(1),
        cy: y(marked).toFixed(1),
        r: 3.5,
      }),
    )
  }

  const scrubber = svgEl("g", { class: "chart-scrub" })
  const rule = svgEl("line", { y1: PAD_TOP - 8, y2: height })
  const dot = svgEl("circle", { r: 4 })
  const when = svgEl("text", { y: 11, "text-anchor": "middle" })
  scrubber.append(rule, dot, when)
  nodes.push(scrubber)
  svg.replaceChildren(...nodes)

  let current: number | null = null
  const scrub = (index: number | null) => {
    const value = index === null ? null : spec.values[index]
    if (index === null || value === null || value === undefined) {
      current = null
      scrubber.removeAttribute("data-on")
      svg.setAttribute("aria-valuetext", spec.describe(n - 1))
      svg.setAttribute("aria-valuenow", String(n - 1))
      return
    }
    current = index
    const px = x(index)
    rule.setAttribute("x1", px.toFixed(1))
    rule.setAttribute("x2", px.toFixed(1))
    dot.setAttribute("cx", px.toFixed(1))
    dot.setAttribute("cy", y(value).toFixed(1))
    when.textContent = spec.dateOf(index)
    when.setAttribute("x", Math.min(width - 44, Math.max(44, px)).toFixed(1))
    scrubber.setAttribute("data-on", "")
    svg.setAttribute("aria-valuetext", spec.describe(index))
    svg.setAttribute("aria-valuenow", String(index))
  }

  const clampIndex = (i: number) =>
    Math.max(Math.max(first, 0), Math.min(n - 1, i))
  const fromPointer = (event: PointerEvent) => {
    const box = svg.getBoundingClientRect()
    const t =
      (event.clientX - box.left - PAD_X) / Math.max(1, box.width - PAD_X * 2)
    return clampIndex(Math.round(t * (n - 1)))
  }
  const move = (index: number | null) => {
    scrub(index)
    spec.onScrub?.(index === null ? null : current)
  }

  svg.setAttribute("role", "slider")
  svg.setAttribute("aria-valuemin", String(Math.max(first, 0)))
  svg.setAttribute("aria-valuemax", String(n - 1))
  svg.tabIndex = 0
  svg.onpointermove = (event) => move(fromPointer(event))
  svg.onpointerdown = (event) => move(fromPointer(event))
  svg.onpointerleave = () => move(null)
  svg.onblur = () => move(null)
  svg.onkeydown = (event) => {
    const at = current ?? n - 1
    const step =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "PageUp"
            ? -5
            : event.key === "PageDown"
              ? 5
              : null
    if (event.key === "Home") move(clampIndex(0))
    else if (event.key === "End") move(n - 1)
    else if (event.key === "Escape") move(null)
    else if (step !== null) move(clampIndex(at + step))
    else return
    event.preventDefault()
  }
  scrub(null)

  if (
    spec.animate &&
    !reduced() &&
    typeof stroke.getTotalLength === "function"
  ) {
    const length = stroke.getTotalLength()
    stroke.animate(
      [
        { strokeDasharray: `${length}`, strokeDashoffset: length },
        { strokeDasharray: `${length}`, strokeDashoffset: 0 },
      ],
      { duration: 900, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
    )
    for (const node of nodes) {
      if (node === stroke || node === scrubber) continue
      node.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 500,
        delay: 350,
        fill: "backwards",
      })
    }
  }

  return { scrub }
}

/** A row's sparkline: a polyline stretched to its box, no axes. */
export function sparkline(values: number[], className: string): SVGSVGElement {
  const svg = svgEl("svg", {
    class: className,
    viewBox: "0 0 100 24",
    preserveAspectRatio: "none",
    "aria-hidden": "true",
  })
  if (values.length < 2) return svg
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const step = Math.max(1, Math.ceil(values.length / 120))
  const points = values
    .filter((_, i) => i % step === 0 || i === values.length - 1)
    .map((value, i, all) => {
      const px = (i / (all.length - 1)) * 100
      const py = 2 + ((hi - value) / (hi - lo || 1)) * 20
      return `${px.toFixed(1)},${py.toFixed(1)}`
    })
  svg.append(
    svgEl("polyline", {
      points: points.join(" "),
      fill: "none",
      "vector-effect": "non-scaling-stroke",
    }),
  )
  return svg
}
