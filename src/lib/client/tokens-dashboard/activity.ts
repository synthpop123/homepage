/**
 * Activity section renderers, both range-independent and rendered once
 * per load: the 12-month heatmap and the "all-time patterns" fact cards.
 */

import { mountHeatmap } from "../heatmap"
import {
  activeTotals,
  computeFacts,
  fillDaily,
  formatCost,
  formatCostExact,
  formatCount,
  formatDate,
  formatDay,
  formatDuration,
  formatExact,
  formatShare,
  formatTokens,
  isMessagesOnly,
  levelScale,
  modelLabel,
  perHour,
  PLACEHOLDER_IDS,
  type Site,
  shiftDays,
} from "../tokens"
import { type Query, setCard } from "./dom"

export function renderHeatmap(q: Query, site: Site) {
  const grid = q(".heat-grid")
  if (!grid) return
  const days = fillDaily(site.daily, shiftDays(site.today, -364), site.today)
  // Quartile levels over the full year, so the fit-to-width slice
  // reads the same at any viewport. Days with messages but no token
  // metadata (early-2025 Cursor logs) render as hollow cells, level -1
  // in Heatmap.astro — real activity, unknown size.
  const level = levelScale(days)
  mountHeatmap(grid, days, (shown) =>
    shown.map((day) => ({
      level: isMessagesOnly(day) ? -1 : level(day.tokens),
      title:
        day.tokens > 0
          ? `${formatTokens(day.tokens)} tokens on ${formatDate(day.date)} · ${formatCostExact(day.cost)} · ${formatCount(day.messages)} ${day.messages === 1 ? "message" : "messages"}${day.active ? ` · ${formatDuration(day.active)} active` : ""}`
          : isMessagesOnly(day)
            ? `${formatCount(day.messages)} ${day.messages === 1 ? "message" : "messages"} on ${formatDate(day.date)} · token counts unavailable`
            : `No usage on ${formatDate(day.date)}`,
    })),
  )
}

export function renderFacts(q: Query, site: Site) {
  const cards = q('[data-cards="facts"]')
  const start = site.ranges.all.totals.firstDate ?? site.today
  const facts = computeFacts(fillDaily(site.daily, start, site.today))
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`

  setCard(
    cards,
    "biggest",
    facts.biggest ? formatTokens(facts.biggest.tokens) : "—",
    facts.biggest
      ? `${formatDate(facts.biggest.date)} · ${formatCost(facts.biggest.cost)}`
      : "no usage yet",
    facts.biggest ? `${formatExact(facts.biggest.tokens)} tokens` : undefined,
  )
  setCard(
    cards,
    "busiest",
    facts.busiestWeek ? formatTokens(facts.busiestWeek.tokens) : "—",
    facts.busiestWeek
      ? `${formatDay(facts.busiestWeek.from)} – ${formatDay(facts.busiestWeek.to)}`
      : "—",
    facts.busiestWeek
      ? `${formatExact(facts.busiestWeek.tokens)} tokens`
      : undefined,
  )
  setCard(
    cards,
    "median",
    facts.median !== null ? formatTokens(facts.median) : "—",
    "median across active days",
    facts.median !== null
      ? `${formatExact(Math.round(facts.median))} tokens`
      : undefined,
  )
  setCard(
    cards,
    "weekday",
    facts.weekday?.name ?? "—",
    facts.weekday ? `${formatShare(facts.weekday.share)} of all tokens` : "—",
  )
  setCard(
    cards,
    "longest",
    facts.longest ? days(facts.longest.length) : "—",
    facts.longest
      ? `${formatDay(facts.longest.from)} – ${formatDay(facts.longest.to)}`
      : "—",
  )
  setCard(
    cards,
    "current",
    facts.current ? days(facts.current.length) : "0 days",
    facts.current ? `since ${formatDay(facts.current.since)}` : "—",
  )

  // Counted off the payload rather than off what the lists render, so
  // the unattributed ids have to be dropped here too.
  const models = site.ranges.all.byModel.filter(
    (entry) => !PLACEHOLDER_IDS.has(entry.model),
  )
  setCard(
    cards,
    "models",
    String(models.length),
    models.length > 0
      ? `across ${site.ranges.all.byClient.length} ${site.ranges.all.byClient.length === 1 ? "client" : "clients"}`
      : "—",
    models.length > 0 ? `most used: ${modelLabel(models[0].model)}` : undefined,
  )

  // Intensity rather than volume: tokens per hour of work that actually
  // happened, over the days the CLI timed — the one ratio the rest of
  // the page can't express.
  const tracked = activeTotals(site.daily)
  setCard(
    cards,
    "activeTime",
    tracked.ms > 0 ? formatDuration(tracked.ms) : "—",
    tracked.ms > 0
      ? `≈ ${formatTokens(perHour(tracked.tokens, tracked.ms))} tokens per hour`
      : "not reported yet",
    tracked.ms > 0
      ? `wall-clock agent time across ${tracked.days} tracked ${
          tracked.days === 1 ? "day" : "days"
        } · ${formatCost(perHour(tracked.cost, tracked.ms))} per hour`
      : undefined,
  )
}
