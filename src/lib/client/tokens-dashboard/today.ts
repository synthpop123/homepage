/**
 * Today section renderer: the current collector day at a glance — four
 * stat cards measured against yesterday, the client mix as one stacked
 * bar, and the models behind it. The numbers come from `todayView`
 * (../tokens), which reads `ranges.day` — the payload's today-only
 * window, and its only per-model split of a single day — so "today" is
 * always the collector's Asia/Shanghai day rather than the visitor's.
 * No control applies to it, so it renders once per load like the
 * heatmap and the device list.
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
  modelLabel,
  type Site,
  todayView,
} from "../tokens"
import { el, type Icons, type Query, setDelta, usageRow } from "./dom"

export function renderToday(q: Query, site: Site, icons: Icons) {
  const { idle, totals, active, before, mix, models } = todayView(site)

  // The date itself is redundant next to a heading that says "Today";
  // how long ago the collector last reported is not.
  const meta = q(".tk-today-meta")
  if (meta) {
    meta.textContent = `updated ${formatAgo(Date.parse(site.generatedAt))}`
    meta.title = formatDate(site.today)
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
        return segment
      }),
    )
    bar.removeAttribute("data-skeleton")
  }

  const legend = q(".tk-today-legend")
  if (legend) {
    legend.replaceChildren(
      ...mix.map((entry) => {
        const item = document.createElement("li")
        const chip = el("span", "chip")
        chip.dataset.p = entry.id
        item.append(
          chip,
          el("span", "name", entry.label),
          el("span", "share", formatShare(entry.share)),
        )
        return item
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
