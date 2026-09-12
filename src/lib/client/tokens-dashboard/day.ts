/**
 * The day panel under the heatmap: whichever day is picked — today
 * until the visitor clicks another — as four stat cards measured
 * against the day before, the client mix as one stacked bar, and every
 * client opened onto the models behind it. All of it comes from
 * `dayView` over the daily series, so a picked day and today render
 * through one path.
 */

import {
  aiIcon,
  type DayView,
  dayView,
  formatCost,
  formatCostExact,
  formatCount,
  formatDate,
  formatDay,
  formatDelta,
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
  setDelta,
  usageRow,
} from "./dom"

export function createDayPanel(q: Query, icons: Icons, onBack: () => void) {
  /** Client rows the visitor has closed. They open by default: the
   *  day's client → model join is what this panel is for. */
  const collapsed = new Set<string>()
  /** The bar's segments by client id, so a legend row can point back at
   *  the slice it stands for. */
  const segments = new Map<string, HTMLElement>()

  // The legend rows lead with a brand icon, like every other list on the
  // page — which leaves the bar above them unkeyed. Pointing at (or
  // tabbing to) a row mutes every segment but its own instead: the same
  // statement a color chip made permanently, on demand, and without a
  // second color language running down the rows.
  //
  // The legend is longer than the bar has segments, so a row past the
  // cutoff lights the residual slice it was merged into — which is
  // where its tokens actually are.
  const highlight = (id: string | null) => {
    const lit = id === null ? null : segments.has(id) ? id : OTHER
    for (const [key, segment] of segments) {
      segment.toggleAttribute("data-mute", lit !== null && key !== lit)
    }
  }
  const clientOf = (target: EventTarget | null) =>
    target instanceof Element
      ? (target.closest<HTMLElement>("[data-client]")?.dataset.client ?? null)
      : null
  const legend = q(".tk-day-legend")
  legend?.addEventListener("pointerover", (event) => {
    // A tap has no matching "leave", so the highlight would stick.
    if (event.pointerType !== "touch") highlight(clientOf(event.target))
  })
  legend?.addEventListener("pointerleave", () => highlight(null))
  legend?.addEventListener("focusin", (event) =>
    highlight(clientOf(event.target)),
  )
  legend?.addEventListener("focusout", () => highlight(null))

  const back = q<HTMLButtonElement>(".tk-day-back")
  back?.addEventListener("click", onBack)

  const renderCards = (view: DayView) => {
    const setStat = (
      key: string,
      value: string,
      exact: string,
      delta: string,
      deltaTitle = "",
    ) => {
      const card = q(`[data-cards="day"] .tk-card[data-key="${key}"]`)
      const valueEl = card?.querySelector<HTMLElement>(".value")
      if (valueEl) {
        valueEl.textContent = value
        valueEl.title = exact
      }
      setDelta(
        card?.querySelector<HTMLElement>(".delta") ?? null,
        delta,
        deltaTitle,
      )
    }

    // Today is still running while its baseline is a finished day, so
    // the tooltip says "full day" rather than letting a morning read as
    // a collapse. A picked day is compared with a peer, and names it.
    const baseline = view.isToday ? "yesterday" : formatDay(view.before.date)
    const vsBefore = (current: number, base: number) =>
      base > 0
        ? `${formatDelta((current - base) / base)} vs ${baseline}`
        : current > 0
          ? `↑ new vs ${baseline}`
          : ""
    const baseTitle = (value: string) =>
      view.isToday
        ? `yesterday, full day: ${value}`
        : `${formatDate(view.before.date)}: ${value}`

    setStat(
      "tokens",
      formatTokens(view.tokens),
      `${formatExact(view.tokens)} tokens`,
      vsBefore(view.tokens, view.before.tokens),
      baseTitle(`${formatExact(view.before.tokens)} tokens`),
    )
    setStat(
      "cost",
      formatCost(view.cost),
      formatCostExact(view.cost),
      vsBefore(view.cost, view.before.cost),
      baseTitle(formatCostExact(view.before.cost)),
    )
    setStat(
      "messages",
      formatCount(view.messages),
      `${formatExact(view.messages)} messages`,
      vsBefore(view.messages, view.before.messages),
      baseTitle(`${formatExact(view.before.messages)} messages`),
    )
    setStat(
      "activeTime",
      view.active > 0 ? formatDuration(view.active) : "—",
      view.active > 0
        ? `${formatExact(Math.round(view.active / 60_000))} minutes`
        : "",
      vsBefore(view.active, view.before.active),
      view.before.active > 0
        ? baseTitle(formatDuration(view.before.active))
        : "",
    )
  }

  const render = (site: Site, date: string) => {
    const view = dayView(site, date)
    segments.clear()

    const label = q(".tk-day-label")
    if (label)
      label.textContent = view.isToday ? "Today" : formatWeekdayDay(date)
    if (back) {
      back.hidden = view.isToday
      back.title = `Back to ${formatDate(site.today)}`
    }

    // A day with nothing on it is a quiet day, not an outage — and a
    // wall of zeroes would read as the latter.
    const body = q(".tk-day-body")
    const empty = q(".tk-day-empty")
    if (body) body.hidden = view.idle
    if (empty) {
      empty.hidden = !view.idle
      empty.textContent = view.isToday
        ? "Zero-byte kind of day."
        : `Nothing logged on ${formatDate(date)}.`
    }
    if (view.idle) return

    renderCards(view)

    // No tokens (a message- or active-time-only day) means nothing to
    // apportion: the breakdown would be an empty bar over a "—" legend.
    const breakdown = q(".tk-day-breakdown")
    if (breakdown) breakdown.hidden = view.clients.length === 0
    if (view.clients.length === 0) return

    // Client mix: the day's top clients keep their vendor hue, the tail
    // merges into one neutral segment so the bar always sums to the day.
    const bar = q(".tk-day-bar")
    if (bar) {
      bar.replaceChildren(
        ...view.mix.map((entry) => {
          const segment = el("span", "")
          segment.dataset.p = entry.id
          segment.style.flexGrow = String(entry.share)
          segment.title = `${entry.label} — ${formatTokens(entry.tokens)} (${formatShare(
            entry.share,
          )})`
          segments.set(entry.id, segment)
          return segment
        }),
      )
      bar.removeAttribute("data-skeleton")
    }

    // The legend under the bar is also the day's client breakdown: the
    // same brand-marked rows the Breakdown section uses, each opened
    // onto the models that client drove. It lists *every* client of the
    // day, however small — the bar's cutoff is a drawing limit, not an
    // editorial one, and a client dropped from the legend loses its
    // name, its icon and its models to a grey row that reads like
    // unattributed usage. `data-client` ties a row to its segment.
    if (legend) {
      legend.replaceChildren(
        ...view.clients.map((entry) => {
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
              : expandableRow(
                  icons,
                  spec,
                  subRows,
                  !collapsed.has(entry.id),
                  () => {
                    if (collapsed.has(entry.id)) collapsed.delete(entry.id)
                    else collapsed.add(entry.id)
                  },
                )
          row.dataset.client = entry.id
          return row
        }),
      )
    }
  }

  return { render }
}
