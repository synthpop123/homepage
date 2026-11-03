/**
 * Patterns: eight all-time cards read off the whole daily series rather
 * than the selected range, which is why the section carries no controls
 * and renders once per payload.
 */

import {
  activeTotals,
  computeFacts,
  fillDaily,
  formatCost,
  formatDate,
  formatDay,
  formatDuration,
  formatExact,
  formatShare,
  formatTokens,
  modelLabel,
  perHour,
  PLACEHOLDER_IDS,
  type Site,
} from "../tokens"
import { type Query, setCard } from "./dom"

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
      ? `${formatDay(facts.biggest.date)}, ${formatCost(facts.biggest.cost)}`
      : "no usage yet",
    facts.biggest
      ? `${formatExact(facts.biggest.tokens)} tokens on ${formatDate(facts.biggest.date)}`
      : undefined,
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
    "on active days",
    facts.median !== null
      ? `${formatExact(Math.round(facts.median))} tokens`
      : undefined,
  )
  setCard(
    cards,
    "weekday",
    facts.weekday?.name ?? "—",
    facts.weekday ? `${formatShare(facts.weekday.share)} of tokens` : "—",
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
  const providers = site.ranges.all.byProvider.filter(
    (entry) => !PLACEHOLDER_IDS.has(entry.provider),
  )
  setCard(
    cards,
    "models",
    String(models.length),
    providers.length > 0
      ? `from ${providers.length} ${providers.length === 1 ? "provider" : "providers"}`
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
      ? `${formatTokens(perHour(tracked.tokens, tracked.ms))} tokens/h`
      : "not reported yet",
    tracked.ms > 0
      ? `wall-clock agent time across ${tracked.days} tracked ${
          tracked.days === 1 ? "day" : "days"
        }, ${formatCost(perHour(tracked.cost, tracked.ms))} per hour`
      : undefined,
  )
}
