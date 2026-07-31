/**
 * Today section renderer: the current collector day at a glance — four
 * stat cards measured against yesterday, the client mix as one stacked
 * bar, and the models behind it. It reads `ranges.day`, the payload's
 * today-only window (and its only per-model split of a single day), so
 * "today" is always the collector's Asia/Shanghai day rather than the
 * visitor's. No control applies to it, so it renders once per load like
 * the heatmap and the device list.
 */

import {
  aiIcon,
  clientLabel,
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
  HIDDEN_MODELS,
  OTHER,
  shiftDays,
  type Site,
  windowTotals,
} from "../tokens"
import { el, type Icons, type Query, setDelta, usageRow } from "./dom"

/** Clients that get their own bar segment; the tail merges into "other". */
const MIX_SEGMENTS = 4
const TOP_MODELS = 5

export function renderToday(q: Query, site: Site, icons: Icons) {
  const stats = site.ranges.day
  const totals = stats.totals
  const today = site.daily.find((day) => day.date === site.today)
  const yesterday = shiftDays(site.today, -1)
  const before = windowTotals(site.daily, yesterday, yesterday)
  const beforeActive =
    site.daily.find((day) => day.date === yesterday)?.active ?? 0
  const active = today?.active ?? 0

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
  const idle = totals.tokens === 0 && totals.messages === 0
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

  /** "↑ 34% vs yesterday" — or nothing, when there is no baseline. */
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
    `yesterday: ${formatExact(before.tokens)} tokens`,
  )
  setStat(
    "cost",
    formatCost(totals.cost),
    formatCostExact(totals.cost),
    vsYesterday(totals.cost, before.cost),
    `yesterday: ${formatCostExact(before.cost)}`,
  )
  setStat(
    "messages",
    formatCount(totals.messages),
    `${formatExact(totals.messages)} messages`,
    vsYesterday(totals.messages, before.messages),
    `yesterday: ${formatExact(before.messages)} messages`,
  )
  setStat(
    "activeTime",
    active > 0 ? formatDuration(active) : "—",
    active > 0 ? `${formatExact(Math.round(active / 60_000))} minutes` : "",
    vsYesterday(active, beforeActive),
    beforeActive > 0 ? `yesterday: ${formatDuration(beforeActive)}` : "",
  )

  // Client mix: the day's top clients keep their vendor hue, the tail
  // merges into one neutral segment so the bar always sums to the day.
  const clients = stats.byClient.filter((row) => row.tokens > 0)
  const tail = clients
    .slice(MIX_SEGMENTS)
    .reduce((sum, row) => sum + row.tokens, 0)
  const mix = [
    ...clients.slice(0, MIX_SEGMENTS).map((row) => ({
      id: row.client,
      label: clientLabel(row.client),
      tokens: row.tokens,
    })),
    ...(tail > 0
      ? [{ id: OTHER, label: clientLabel(OTHER), tokens: tail }]
      : []),
  ]
  const total = totals.tokens

  const bar = q(".tk-today-bar")
  if (bar) {
    bar.replaceChildren(
      ...mix.map((entry) => {
        const segment = el("span", "")
        segment.dataset.p = entry.id
        segment.style.flexGrow = String(entry.tokens / total)
        segment.title = `${entry.label} — ${formatTokens(entry.tokens)} (${formatShare(
          entry.tokens / total,
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
          el("span", "share", formatShare(entry.tokens / total)),
        )
        return item
      }),
    )
  }

  const list = q('.tk-rows[data-list="today-model"]')
  if (list) {
    const models = stats.byModel
      .filter((row) => row.tokens > 0 && !HIDDEN_MODELS.has(row.model))
      .slice(0, TOP_MODELS)
    list.replaceChildren(
      ...(models.length > 0
        ? models.map((row) =>
            usageRow(icons, {
              icon: aiIcon("model", row.model),
              name: row.model,
              value: formatTokens(row.tokens),
              share: total > 0 ? row.tokens / total : NaN,
              title: `${row.model} — ${formatExact(row.tokens)} tokens · ${formatCostExact(
                row.cost,
              )} · ${formatExact(row.messages)} messages`,
            }),
          )
        : [el("li", "tk-empty", "No model usage recorded yet today.")]),
    )
  }
}
