/**
 * Overview section renderer: the four stat cards with their
 * period-over-period deltas, and the token-composition bar + legend.
 */

import {
  COMPOSITION,
  formatCost,
  formatCostExact,
  formatCount,
  formatDelta,
  formatExact,
  formatShare,
  formatTokens,
  type RangeKey,
  rangeMeta,
  type Site,
  shiftDays,
  windowTotals,
} from "../tokens"
import { el, type Query, setCard, setDelta as fillDelta } from "./dom"

export function renderOverview(q: Query, site: Site, range: RangeKey) {
  const stats = site.ranges[range]
  const totals = stats.totals
  const meta = rangeMeta(range)
  const cards = q('[data-cards="overview"]')

  const setDelta = (key: string, text: string, title = "") =>
    fillDelta(
      q(`[data-cards="overview"] .tk-card[data-key="${key}"] .delta`),
      text,
      title,
    )

  // Figure and comparison only: the range toggle above already says
  // which window both are over, so neither repeats it.
  setCard(
    cards,
    "tokens",
    formatTokens(totals.tokens),
    undefined,
    `${formatExact(totals.tokens)} tokens`,
  )
  setCard(
    cards,
    "cost",
    formatCost(totals.cost),
    undefined,
    formatCostExact(totals.cost),
  )
  setCard(
    cards,
    "messages",
    formatCount(totals.messages),
    undefined,
    formatExact(totals.messages),
  )
  setCard(cards, "activeDays", String(totals.activeDays))

  // Period-over-period: same-length window immediately before this one.
  if (meta.days && stats.from) {
    const prev = windowTotals(
      site.daily,
      shiftDays(stats.from, -meta.days),
      shiftDays(stats.from, -1),
    )
    const prior = `prior ${meta.days} days`
    const ratio = (cur: number, base: number) => (cur - base) / base
    const numeric = (
      key: "tokens" | "cost" | "messages",
      format: (n: number) => string,
    ) => {
      if (prev[key] > 0)
        setDelta(
          key,
          `${formatDelta(ratio(totals[key], prev[key]))} vs prior`,
          `${prior}: ${format(prev[key])}`,
        )
      else setDelta(key, totals[key] > 0 ? "↑ new" : "")
    }
    numeric("tokens", (n) => `${formatExact(n)} tokens`)
    numeric("cost", formatCostExact)
    numeric("messages", formatExact)
    const dayDiff = totals.activeDays - prev.activeDays
    setDelta(
      "activeDays",
      dayDiff === 0
        ? "→ unchanged"
        : `${dayDiff > 0 ? "↑" : "↓"} ${Math.abs(dayDiff)} vs prior`,
      `${prior}: ${prev.activeDays} active days`,
    )
  } else {
    for (const key of ["tokens", "cost", "messages", "activeDays"]) {
      setDelta(key, "")
    }
  }

  const bar = q(".tk-mix-composition")
  const legend = q(".tk-mix-legend")
  const sum = COMPOSITION.reduce((acc, part) => acc + totals[part.key], 0)
  if (bar) {
    bar.replaceChildren(
      ...COMPOSITION.flatMap((part, i) => {
        const value = totals[part.key]
        if (value <= 0) return []
        const segment = el("span", "")
        segment.dataset.k = String(i)
        segment.style.flexGrow = String(value / sum)
        segment.title = `${part.label} — ${formatTokens(value)} (${formatShare(value / sum)})`
        return [segment]
      }),
    )
    bar.removeAttribute("data-skeleton")
  }
  for (const part of COMPOSITION) {
    const item = legend?.querySelector<HTMLElement>(`[data-key="${part.key}"]`)
    const value = item?.querySelector<HTMLElement>(".value")
    const share = item?.querySelector<HTMLElement>(".share")
    if (!value || !share) continue
    const amount = totals[part.key]
    value.textContent = sum > 0 ? formatTokens(amount) : "—"
    value.title = `${formatExact(amount)} tokens`
    share.textContent = sum > 0 ? formatShare(amount / sum) : ""
  }
}
