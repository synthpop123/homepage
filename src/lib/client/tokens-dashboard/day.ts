/**
 * The day panel under the heatmap: whichever day is picked — today
 * until the visitor clicks another — as one row of four stat cards, the
 * client mix as a ring, and beside it every
 * client of the day, one at a time opened onto the models behind it.
 * All of it comes from `dayView` over the daily series, so a picked day
 * and today render through one path.
 */

import { setReadout } from "../readout"
import {
  aiIcon,
  type DayMix,
  type DayView,
  dayView,
  formatCost,
  formatCostExact,
  formatCount,
  formatDate,
  formatDuration,
  formatExact,
  formatShare,
  formatTokens,
  formatWeekdayDay,
  OTHER,
  type Site,
} from "../tokens"
import {
  el,
  expandableRow,
  type Icons,
  modelSubRows,
  type Query,
  setExpanded,
  usageRow,
} from "./dom"

/* Ring geometry, in viewBox units (0 0 100 100). The stroke is the one
   in Tokens.astro's `.tk-donut circle`, which draws it. */
const RADIUS = 42
const STROKE = 6
/** Air between two arcs, measured from cap to cap. It has to outlast
 *  the focused arc's wider stroke, whose caps reach further. */
const GAP = 5
const AROUND = 2 * Math.PI * RADIUS
const SVG_NS = "http://www.w3.org/2000/svg"

/**
 * One arc per slice, clockwise from twelve o'clock (the svg is turned a
 * quarter in CSS). Round caps reach half a stroke past each end of a
 * dash, so every dash is drawn short by a stroke plus the gap; a slice
 * too thin to survive that lands as a dot centred on its share, the
 * same way a sliver of the quota meters does.
 */
const ringArcs = (mix: DayMix[]) => {
  const trim = mix.length > 1 ? STROKE + GAP : 0
  let start = 0
  return mix.map((entry) => {
    const span = entry.share * AROUND
    const length = Math.max(span - trim, 0.01)
    const arc = document.createElementNS(SVG_NS, "circle")
    arc.setAttribute("cx", "50")
    arc.setAttribute("cy", "50")
    arc.setAttribute("r", String(RADIUS))
    arc.setAttribute("stroke-dasharray", `${length} ${AROUND}`)
    arc.setAttribute(
      "stroke-dashoffset",
      String(-(start + (span - length) / 2)),
    )
    arc.dataset.p = entry.id
    arc.dataset.client = entry.id
    start += span
    return arc
  })
}

export function createDayPanel(q: Query, icons: Icons, onBack: () => void) {
  let view: DayView | null = null
  /** The client whose models are open and whose share the ring's centre
   *  names. The day's largest until the visitor opens another; it
   *  survives a refresh or a new day as long as that client is on it. */
  let focus: string | null = null
  /** The ring's arcs by client id (or OTHER), so a legend row can point
   *  back at the slice it stands for. */
  const arcs = new Map<string, SVGCircleElement>()

  const ring = q(".tk-donut")
  const svg = ring?.querySelector("svg") ?? null
  const centerValue = q(".tk-donut-focus .value")
  const centerLabel = q(".tk-donut-focus .caption")
  const legend = q(".tk-day-legend")

  /** A row past the ring's cutoff lives in the residual slice — which
   *  is where its tokens actually are. */
  const arcOf = (id: string | null) =>
    id === null ? null : arcs.has(id) ? id : OTHER

  /** The centre names one client — its share, then its name — or, with
   *  nothing in focus, the day's total. The residual slice is named by
   *  how many clients it folds. */
  const showCenter = (id: string | null) => {
    if (!view || !centerValue || !centerLabel) return
    const entry =
      id === OTHER
        ? view.mix.find((slice) => slice.id === OTHER)
        : view.clients.find((client) => client.id === id)
    const label =
      id === OTHER
        ? `${view.clients.length - view.mix.length + 1} others`
        : (entry?.label ?? "tokens")
    centerValue.textContent = entry
      ? formatShare(entry.share)
      : formatTokens(view.tokens)
    centerValue.title = entry
      ? `${formatExact(entry.tokens)} tokens`
      : `${formatExact(view.tokens)} tokens`
    centerLabel.textContent = label
  }

  // Pointing at (or tabbing to) a slice or a row previews it: every
  // other arc mutes and the centre names it. Letting go falls back to
  // the focus, so a preview never costs the visitor their place.
  const preview = (id: string | null) => {
    const lit = arcOf(id)
    for (const [key, arc] of arcs) {
      arc.toggleAttribute("data-mute", lit !== null && key !== lit)
    }
    showCenter(id ?? focus)
  }

  /** Open one client and close the rest: the list is an accordion, so
   *  the panel stays about as tall as the ring beside it. */
  const select = (id: string | null) => {
    focus = id
    const lit = arcOf(id)
    for (const [key, arc] of arcs)
      arc.toggleAttribute("data-focus", key === lit)
    legend
      ?.querySelectorAll<HTMLElement>(".tk-group")
      .forEach((group) => setExpanded(group, group.dataset.client === id))
    showCenter(id)
  }

  const clientOf = (target: EventTarget | null) =>
    target instanceof Element
      ? (target
          .closest<Element>("[data-client]")
          ?.getAttribute("data-client") ?? null)
      : null
  const breakdown = q(".tk-day-breakdown")
  breakdown?.addEventListener("pointerover", (event) => {
    // A tap has no matching "leave", so the preview would stick.
    if (event.pointerType !== "touch") preview(clientOf(event.target))
  })
  breakdown?.addEventListener("pointerleave", () => preview(null))
  breakdown?.addEventListener("focusin", (event) =>
    preview(clientOf(event.target)),
  )
  breakdown?.addEventListener("focusout", () => preview(null))
  // A slice is a pointer shortcut to its row; the rows are the keyboard
  // path. The residual slice has no one row to open.
  svg?.addEventListener("click", (event) => {
    const id = clientOf(event.target)
    if (id !== null && id !== OTHER) select(id)
  })

  const back = q<HTMLButtonElement>(".tk-day-back")
  back?.addEventListener("click", onBack)

  const renderCards = (view: DayView) => {
    const setStat = (key: string, value: string, exact: string) => {
      const valueEl = q(`[data-cards="day"] .tk-card[data-key="${key}"] .value`)
      if (!valueEl) return
      setReadout(valueEl, value)
      valueEl.title = exact
    }

    setStat(
      "tokens",
      formatTokens(view.tokens),
      `${formatExact(view.tokens)} tokens`,
    )
    setStat("cost", formatCost(view.cost), formatCostExact(view.cost))
    setStat(
      "messages",
      formatCount(view.messages),
      `${formatExact(view.messages)} messages`,
    )
    setStat(
      "activeTime",
      view.active > 0 ? formatDuration(view.active) : "—",
      view.active > 0
        ? `${formatExact(Math.round(view.active / 60_000))} minutes`
        : "",
    )
  }

  const render = (site: Site, date: string) => {
    view = dayView(site, date)

    const label = q(".tk-day-label")
    if (label)
      label.textContent = view.isToday ? "Today" : formatWeekdayDay(date)
    if (back) {
      back.hidden = view.isToday
      back.title = `Back to ${formatDate(site.today)}`
    }

    // A day with nothing on it is a quiet day, not an outage — and a
    // wall of zeroes would read as the latter. The line is the same
    // whichever day it is: the heading above already names the day, so
    // repeating the date here only made the empty state longer.
    const body = q(".tk-day-body")
    const empty = q(".tk-day-empty")
    if (body) body.hidden = view.idle
    if (empty) empty.hidden = !view.idle
    if (view.idle) return

    renderCards(view)

    // No tokens (a message- or active-time-only day) means nothing to
    // apportion: the breakdown would be an empty ring over a "—" legend.
    if (breakdown) breakdown.hidden = view.clients.length === 0
    if (view.clients.length === 0) return

    arcs.clear()
    for (const arc of ringArcs(view.mix)) {
      arcs.set(arc.dataset.client ?? "", arc)
    }
    svg?.replaceChildren(...arcs.values())
    ring?.removeAttribute("data-skeleton")

    // The legend is also the day's client breakdown: the same
    // brand-marked rows the Breakdown section uses, each able to open
    // onto the models that client drove. It lists *every* client of the
    // day, however small — the ring's cutoff is a drawing limit, not an
    // editorial one. `data-p` tints a row's mark with its slice's hue,
    // which is what keys the ring without a second set of chips; a row
    // folded into the residual slice takes that slice's grey.
    const { clients } = view
    legend?.replaceChildren(
      ...clients.map((entry) => {
        const spec = {
          icon: aiIcon("client", entry.id),
          name: entry.label,
          value: formatTokens(entry.tokens),
          share: entry.share,
          title: `${entry.label} — ${formatExact(entry.tokens)} tokens · ${formatCostExact(
            entry.models.reduce((sum, cell) => sum + cell.cost, 0),
          )}`,
        }
        const subRows = modelSubRows(entry.models, entry.tokens, "tokens")
        const row =
          subRows.length === 0
            ? usageRow(icons, spec)
            : expandableRow(icons, spec, subRows, false, () =>
                select(focus === entry.id ? null : entry.id),
              )
        row.dataset.client = entry.id
        row.dataset.p = arcOf(entry.id) ?? OTHER
        return row
      }),
    )

    select(
      clients.some((entry) => entry.id === focus)
        ? focus
        : (clients[0]?.id ?? null),
    )
  }

  return { render }
}
