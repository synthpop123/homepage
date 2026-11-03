/**
 * Trend section renderers: the stacked daily/monthly bar chart and the
 * Mon–Sun "weekly rhythm" SVG line chart, each owning its tooltip and
 * hover wiring. Both are factories so their hover state stays private
 * to the chart it belongs to.
 */

import {
  type Bucket,
  dailyBuckets,
  fillDaily,
  formatCost,
  formatCount,
  formatDuration,
  formatMetric,
  formatShare,
  formatTokens,
  type MetricKey,
  monthlyBuckets,
  perHour,
  type RangeKey,
  rangeMeta,
  type Site,
  type Stack,
  type StackDim,
  stackFor,
  stackLabel,
  stackPaint,
  modelVendors,
  type StackPaint,
  WEEKDAYS,
  type WeekdayStat,
  weekdayProfile,
} from "../tokens"
import { el, paint, placeTip, type Query } from "./dom"

/* Trend: bars stacked by provider/client; monthly buckets for all time */

export function createTrendChart(q: Query) {
  const chart = q(".tk-chart")
  const tip = q(".tk-tip")
  const barsArea = q(".tk-chart-bars")
  let stack: Stack = { dim: "provider", ids: [] }
  let paints: StackPaint[] = []
  let tipBuckets: Bucket[] = []
  let tipMetric: MetricKey = "tokens"

  const buildTip = (bucket: Bucket) => {
    if (!tip) return
    const rows = stack.ids
      .map((id, i) => ({ id, value: bucket.segments[i], paint: paints[i] }))
      .filter((row) => row.value > 0)
    const list = el("ul", "")
    for (const row of rows) {
      const item = el("li", "")
      item.append(
        paint(el("span", "chip"), row.paint),
        el("span", "tip-label", stackLabel(stack.dim, row.id)),
        el("span", "tip-value", formatMetric(row.value, tipMetric)),
        el("span", "tip-share", formatShare(row.value / bucket[tipMetric])),
      )
      list.append(item)
    }
    // Intensity, where the CLI tracked the hours behind the numbers: the
    // ratio is taken over those days alone, so a month that was only
    // half tracked still reports the rate of the half it knows.
    const summary = el("div", "tip-summary")
    if (bucket.tokens > 0 || bucket.cost > 0) {
      summary.append(
        el("span", "", `${formatTokens(bucket.tokens)} tokens`),
        el("span", "", formatCost(bucket.cost)),
        el(
          "span",
          "",
          `${formatCount(bucket.messages)} ${bucket.messages === 1 ? "message" : "messages"}`,
        ),
      )
    } else {
      summary.append(
        el(
          "span",
          "",
          bucket.messages > 0
            ? `${formatCount(bucket.messages)} ${bucket.messages === 1 ? "message" : "messages"}`
            : "No usage",
        ),
        ...(bucket.messages > 0
          ? [el("span", "", "Token counts unavailable")]
          : []),
      )
    }
    const intensity = el("div", "tip-summary tip-intensity")
    if (bucket.active > 0) {
      intensity.append(
        el("span", "", `${formatDuration(bucket.active)} active`),
        el(
          "span",
          "",
          `≈ ${formatMetric(perHour(bucket.activeMetric, bucket.active), tipMetric)}${tipMetric === "tokens" ? " tokens" : ""}/h`,
        ),
      )
    }
    tip.replaceChildren(
      el("strong", "tip-title", bucket.title),
      summary,
      ...(bucket.active > 0 ? [intensity] : []),
      ...(rows.length > 0 ? [list] : []),
    )
  }

  const hideTip = () => {
    if (tip) tip.hidden = true
  }

  const showTip = (bar: HTMLElement) => {
    const bucket = tipBuckets[Number(bar.dataset.i)]
    if (!tip || !chart || !bucket) return
    buildTip(bucket)
    tip.hidden = false
    placeTip(tip, bar, chart)
  }

  /* A hover previews a bar; a click, a tap or the arrow keys pin one,
     and the tip stays on it until the chart loses focus. The bars are
     one tab stop, not one per day. */
  const status = q(".tk-chart-status")
  let pinned: number | null = null
  const bar = (index: number | null) =>
    index === null
      ? null
      : (barsArea?.querySelector<HTMLElement>(`span[data-i="${index}"]`) ??
        null)

  const pin = (index: number | null) => {
    bar(pinned)?.removeAttribute("data-current")
    pinned = index
    const current = bar(index)
    if (!current) return hideTip()
    current.dataset.current = ""
    showTip(current)
    const bucket = tipBuckets[index ?? 0]
    if (status && bucket) {
      status.textContent = `${bucket.title}: ${
        bucket[tipMetric] > 0
          ? `${formatMetric(bucket[tipMetric], tipMetric)}${tipMetric === "tokens" ? " tokens" : ""}`
          : "no usage"
      }`
    }
  }

  barsArea?.addEventListener("pointerover", (event) => {
    const hovered = (event.target as Element).closest<HTMLElement>(
      "span[data-i]",
    )
    if (hovered) showTip(hovered)
  })
  barsArea?.addEventListener("pointerleave", () => {
    const current = bar(pinned)
    if (current) showTip(current)
    else hideTip()
  })
  barsArea?.addEventListener("click", (event) => {
    const clicked = (event.target as Element).closest<HTMLElement>(
      "span[data-i]",
    )
    if (!clicked) return
    const index = Number(clicked.dataset.i)
    pin(index === pinned ? null : index)
  })
  barsArea?.addEventListener("keydown", (event) => {
    const last = tipBuckets.length - 1
    if (last < 0 || event.altKey || event.ctrlKey || event.metaKey) return
    const from = pinned ?? last + 1
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, from - 1)
        : event.key === "ArrowRight"
          ? Math.min(last, pinned === null ? last : from + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : event.key === "Escape" && pinned !== null
                ? null
                : undefined
    if (next === undefined) return
    event.preventDefault()
    pin(next)
  })
  barsArea?.addEventListener("focusout", () => pin(null))

  const render = (
    site: Site,
    range: RangeKey,
    metric: MetricKey,
    dim: StackDim,
  ) => {
    stack = stackFor(site.ranges[range], dim, metric)
    paints = stackPaint(stack, modelVendors(site.ranges.all))
    const meta = rangeMeta(range)
    const from = site.ranges[range].from
    const buckets =
      range === "all" || !from
        ? monthlyBuckets(site.daily, site.today, stack, metric)
        : dailyBuckets(fillDaily(site.daily, from, site.today), stack, metric)
    const values = buckets.map((bucket) => bucket[metric])
    const max = Math.max(...values, 0)
    const total = values.reduce((acc, value) => acc + value, 0)
    const peakBucket = buckets[values.indexOf(max)]
    const noun = metric === "cost" ? "cost" : "tokens"
    const scopeText =
      range === "all"
        ? `Monthly ${noun}, all time`
        : `Daily ${noun}, last ${meta.days} days`

    const scope = q(".tk-chart-scope")
    if (scope) scope.textContent = scopeText
    const peak = q(".tk-chart-peak")
    if (peak) {
      peak.textContent = total > 0 ? `peak ${formatMetric(max, metric)}` : ""
      peak.title = total > 0 && peakBucket ? peakBucket.title : ""
    }

    tipBuckets = buckets
    tipMetric = metric
    pinned = null
    hideTip()

    if (barsArea) {
      barsArea.replaceChildren(
        ...buckets.map((bucket, index) => {
          const bar = el("span", "")
          const value = bucket[metric]
          bar.dataset.i = String(index)
          bar.style.setProperty("--v", String(max > 0 ? value / max : 0))
          if (value <= 0) bar.dataset.zero = ""
          else
            bar.append(
              ...stack.ids.flatMap((_, i) => {
                const share = bucket.segments[i]
                if (share <= 0) return []
                const segment = paint(document.createElement("i"), paints[i])
                segment.style.flexGrow = String(share)
                return [segment]
              }),
            )
          return bar
        }),
      )
      barsArea.removeAttribute("data-skeleton")
    }

    const axis = q(".tk-chart-axis")
    if (axis && buckets.length > 0) {
      const marks = [
        ...new Set([
          0,
          Math.floor((buckets.length - 1) / 2),
          buckets.length - 1,
        ]),
      ]
      axis.replaceChildren(
        ...marks.map((i) => el("span", "", buckets[i].label)),
      )
    }

    const legend = q(".tk-chart-legend")
    if (legend) {
      const active = stack.ids.filter((_, i) =>
        buckets.some((bucket) => bucket.segments[i] > 0),
      )
      legend.replaceChildren(
        ...active.map((id) => {
          const item = el("li", "")
          item.append(
            paint(el("span", "chip"), paints[stack.ids.indexOf(id)]),
            stackLabel(stack.dim, id),
          )
          return item
        }),
      )
    }

    barsArea?.setAttribute(
      "aria-label",
      `${
        total > 0 && peakBucket
          ? `${scopeText}: ${formatMetric(total, metric)} in total, peaking at ${formatMetric(max, metric)} (${peakBucket.title})`
          : `${scopeText}: no usage recorded`
      }. Arrow keys step through the bars.`,
    )
  }

  return { render }
}

/* Weekly rhythm: average consumption per weekday as a line chart */

export function createRhythmChart(q: Query) {
  const rhythm = q(".tk-rhythm")
  const plot = q(".tk-rhythm-plot")
  const tip = q<HTMLElement>(".tk-rhythm .tk-tip")
  let stats: WeekdayStat[] = []
  let metric: MetricKey = "tokens"
  /** The 7-day window holds exactly one of each weekday. */
  let single = false

  const draw = () => {
    if (!plot || stats.length === 0) return
    const width = plot.clientWidth
    const height = plot.clientHeight
    if (width === 0 || height === 0) return

    const max = Math.max(...stats.map((stat) => stat.average))
    const padTop = 8
    const padBottom = 4
    const inner = height - padTop - padBottom
    const x = (i: number) => ((i + 0.5) / stats.length) * width
    const y = (value: number) =>
      padTop + (1 - (max > 0 ? value / max : 0)) * inner

    const ns = "http://www.w3.org/2000/svg"
    const shape = (tag: string, attrs: Record<string, string>) => {
      const node = document.createElementNS(ns, tag)
      for (const [name, value] of Object.entries(attrs)) {
        node.setAttribute(name, value)
      }
      return node
    }

    const svg = shape("svg", {
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
    }) as SVGSVGElement

    // Quarter gridlines of the value scale, echoing the trend chart.
    if (max > 0) {
      for (const ratio of [0.25, 0.5, 0.75, 1]) {
        svg.append(
          shape("line", {
            class: "grid",
            x1: "0",
            x2: String(width),
            y1: String(y(max * ratio)),
            y2: String(y(max * ratio)),
          }),
        )
      }
    }

    const points = stats.map((stat, i) => [x(i), y(stat.average)])
    const line = points
      .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px} ${py}`)
      .join(" ")
    svg.append(
      shape("path", {
        class: "area",
        d: `${line} L${points[points.length - 1][0]} ${height} L${points[0][0]} ${height} Z`,
      }),
      shape("path", { class: "line", d: line }),
    )

    const peakIndex = stats.findIndex((stat) => stat.average === max)
    points.forEach(([px, py], i) => {
      const dot = shape("circle", {
        class: "dot",
        cx: String(px),
        cy: String(py),
        r: i === peakIndex && max > 0 ? "4" : "3",
      })
      if (i === peakIndex && max > 0) dot.dataset.peak = ""
      svg.append(dot)
    })

    // Invisible hover columns, one per weekday.
    stats.forEach((_, i) => {
      svg.append(
        shape("rect", {
          class: "hit",
          "data-i": String(i),
          x: String((i / stats.length) * width),
          y: "0",
          width: String(width / stats.length),
          height: String(height),
        }),
      )
    })

    plot.replaceChildren(svg)
    plot.removeAttribute("data-skeleton")
  }

  const hideTip = () => {
    if (tip) tip.hidden = true
  }

  const showTip = (hit: SVGElement) => {
    const stat = stats[Number(hit.dataset.i)]
    if (!tip || !rhythm || !stat) return
    const name = WEEKDAYS[stat.weekday]
    const lines: string[] = []
    if (stat.occurrences === 0) {
      lines.push("No data")
    } else if (single) {
      lines.push(stat.total > 0 ? formatMetric(stat.total, metric) : "No usage")
    } else {
      lines.push(
        `≈ ${formatMetric(stat.average, metric)} on average, ${formatMetric(stat.total, metric)} total`,
        `active on ${stat.activeDays} of ${stat.occurrences} ${name}s`,
      )
    }
    tip.replaceChildren(
      el("strong", "tip-title", name),
      ...lines.map((line) => el("span", "tip-total", line)),
    )
    tip.hidden = false
    placeTip(tip, hit, rhythm)
  }

  plot?.addEventListener("pointerover", (event) => {
    const hit = (event.target as Element).closest<SVGElement>("rect[data-i]")
    if (hit) showTip(hit)
  })
  plot?.addEventListener("pointerleave", hideTip)
  // Redraw to the container's width; a no-op until the first render.
  if (plot) new ResizeObserver(draw).observe(plot)

  const render = (site: Site, range: RangeKey, nextMetric: MetricKey) => {
    const meta = rangeMeta(range)
    const from =
      site.ranges[range].from ?? site.ranges.all.totals.firstDate ?? site.today
    stats = weekdayProfile(fillDaily(site.daily, from, site.today), nextMetric)
    metric = nextMetric
    single = range === "week"
    hideTip()

    const noun = nextMetric === "cost" ? "cost" : "tokens"
    const scope = q(".tk-rhythm-scope")
    if (scope) {
      scope.textContent = `Weekday ${noun}, ${meta.days ? `last ${meta.days} days` : "all time"}`
    }

    const max = Math.max(...stats.map((stat) => stat.average))
    const peakStat = stats.find((stat) => stat.average === max)
    const peak = q(".tk-rhythm-peak")
    if (peak) {
      peak.textContent =
        max > 0 && peakStat
          ? `peak ${WEEKDAYS[peakStat.weekday].slice(0, 3)} ${formatMetric(max, nextMetric)}`
          : ""
    }
    rhythm?.setAttribute(
      "aria-label",
      max > 0 && peakStat
        ? `Average daily ${noun} by weekday: peaks on ${WEEKDAYS[peakStat.weekday]} at ${formatMetric(max, nextMetric)}`
        : `Average daily ${noun} by weekday: no usage recorded`,
    )

    draw()
  }

  return { render }
}
