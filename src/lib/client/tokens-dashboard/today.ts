/**
 * Today section renderer: the current collector day at a glance — four
 * stat cards measured against yesterday, the client mix as one stacked
 * bar, and the models behind it. The numbers come from `todayView`
 * (../tokens), which reads `ranges.day` — the payload's today-only
 * window, and its only per-model split of a single day — so "today" is
 * always the collector's Asia/Shanghai day rather than the visitor's.
 * No control applies to it, so it renders once per load like the
 * heatmap and the device list — a factory only because the client
 * disclosures must stay open across a refresh.
 */

import {
  aiIcon,
  formatAgo,
  formatCost,
  formatCostExact,
  formatCount,
  formatDate,
  formatDelta,
  formatDuration,
  formatExact,
  formatShare,
  formatTokens,
  lastReport,
  modelLabel,
  type Site,
  todayView,
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

export function createToday(q: Query, icons: Icons) {
  /** Client rows opened onto their models; survives a re-render. */
  const open = new Set<string>()
  /** The bar's segments by client id, so a legend row can point back at
   *  the slice it stands for. */
  const segments = new Map<string, HTMLElement>()

  // The legend rows lead with a brand icon, like every other list on the
  // page — which leaves the bar above them unkeyed. Pointing at (or
  // tabbing to) a row mutes every segment but its own instead: the same
  // statement a color chip made permanently, on demand, and without a
  // second color language running down the rows.
  const highlight = (id: string | null) => {
    for (const [key, segment] of segments) {
      segment.toggleAttribute("data-mute", id !== null && key !== id)
    }
  }
  const clientOf = (target: EventTarget | null) =>
    target instanceof Element
      ? (target.closest<HTMLElement>("[data-client]")?.dataset.client ?? null)
      : null
  const legend = q(".tk-today-legend")
  legend?.addEventListener("pointerover", (event) => {
    // A tap has no matching "leave", so the highlight would stick.
    if (event.pointerType !== "touch") highlight(clientOf(event.target))
  })
  legend?.addEventListener("pointerleave", () => highlight(null))
  legend?.addEventListener("focusin", (event) =>
    highlight(clientOf(event.target)),
  )
  legend?.addEventListener("focusout", () => highlight(null))

  const render = (site: Site) => {
    segments.clear()
    const { idle, totals, active, before, mix, models } = todayView(site)

    // The date itself is redundant next to a heading that says "Today";
    // how long ago a machine last reported is not — and that is what the
    // device list says too, so the two are one statement. `generatedAt` is
    // a different clock: the collector recomposes on every submission,
    // including the 80% that change nothing, so it would read "just now"
    // through an idle afternoon. It stays as the fallback for a payload
    // with no devices in it at all.
    const meta = q(".tk-today-meta")
    if (meta) {
      const seen = lastReport(site)
      const stamp = seen ?? Date.parse(site.generatedAt)
      meta.textContent = `${seen === null ? "collected" : "synced"} ${formatAgo(stamp)}`
      meta.title = `${formatDate(site.today)} · ${
        seen === null ? "collector last ran" : "last device report"
      } ${new Date(stamp).toLocaleString()}`
    }

    // Before the first submission of the day there is nothing to draw —
    // and a wall of zeroes would read as an outage rather than a quiet
    // morning.
    const body = q(".tk-today-body")
    const empty = q(".tk-today-empty")
    if (body) body.hidden = idle
    if (empty) empty.hidden = !idle
    if (idle) return

    const setStat = (
      key: string,
      value: string,
      exact: string,
      delta: string,
      deltaTitle = "",
    ) => {
      const card = q(`[data-cards="today"] .tk-card[data-key="${key}"]`)
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

    /** "↑ 34% vs yesterday" — or nothing, when there is no baseline. The
     *  baseline is a *finished* day and this one is still running, so the
     *  tooltip says so rather than letting a morning read as a collapse. */
    const vsYesterday = (current: number, base: number) =>
      base > 0
        ? `${formatDelta((current - base) / base)} vs yesterday`
        : current > 0
          ? "↑ new vs yesterday"
          : ""

    setStat(
      "tokens",
      formatTokens(totals.tokens),
      `${formatExact(totals.tokens)} tokens`,
      vsYesterday(totals.tokens, before.tokens),
      `yesterday, full day: ${formatExact(before.tokens)} tokens`,
    )
    setStat(
      "cost",
      formatCost(totals.cost),
      formatCostExact(totals.cost),
      vsYesterday(totals.cost, before.cost),
      `yesterday, full day: ${formatCostExact(before.cost)}`,
    )
    setStat(
      "messages",
      formatCount(totals.messages),
      `${formatExact(totals.messages)} messages`,
      vsYesterday(totals.messages, before.messages),
      `yesterday, full day: ${formatExact(before.messages)} messages`,
    )
    setStat(
      "activeTime",
      active > 0 ? formatDuration(active) : "—",
      active > 0 ? `${formatExact(Math.round(active / 60_000))} minutes` : "",
      vsYesterday(active, before.active),
      before.active > 0
        ? `yesterday, full day: ${formatDuration(before.active)}`
        : "",
    )

    // No tokens yet (a message- or active-time-only day) means nothing to
    // apportion: the breakdown would be an empty bar over a "—" legend.
    const breakdown = q(".tk-today-breakdown")
    if (breakdown) breakdown.hidden = mix.length === 0
    if (mix.length === 0) return

    // Client mix: the day's top clients keep their vendor hue, the tail
    // merges into one neutral segment so the bar always sums to the day.
    const bar = q(".tk-today-bar")
    if (bar) {
      bar.replaceChildren(
        ...mix.map((entry) => {
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

    // The legend under the bar is also the client breakdown: the brand
    // mark, the day's tokens, and the models that client drove behind a
    // disclosure. Same rows as the Breakdown section, which has no today
    // window of its own. `data-client` is what ties a row back to its
    // segment for `highlight`.
    if (legend) {
      legend.replaceChildren(
        ...mix.map((entry) => {
          const spec = {
            icon: aiIcon("client", entry.id),
            name: entry.label,
            value: formatTokens(entry.tokens),
            share: entry.share,
            title: `${entry.label} — ${formatExact(entry.tokens)} tokens`,
          }
          // Only the merged "Other" tail carries no per-model split.
          const subRows = modelSubRows(entry.models, entry.tokens, "tokens")
          const row =
            subRows.length === 0
              ? usageRow(icons, spec)
              : expandableRow(icons, spec, subRows, open.has(entry.id), () => {
                  if (open.has(entry.id)) open.delete(entry.id)
                  else open.add(entry.id)
                })
          row.dataset.client = entry.id
          return row
        }),
      )
    }

    const list = q('.tk-rows[data-list="today-model"]')
    if (list) {
      list.replaceChildren(
        ...(models.length > 0
          ? models.map((row) => {
              const name = modelLabel(row.model)
              return usageRow(icons, {
                icon: aiIcon("model", row.model),
                name,
                value: formatTokens(row.tokens),
                share: row.tokens / totals.tokens,
                title: `${name} — ${formatExact(row.tokens)} tokens · ${formatCostExact(
                  row.cost,
                )} · ${formatExact(row.messages)} messages`,
              })
            })
          : [el("li", "tk-empty", "No model usage recorded yet today.")]),
      )
    }
  }

  return { render }
}
