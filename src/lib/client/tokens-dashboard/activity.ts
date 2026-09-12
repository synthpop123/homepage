/**
 * Activity section: a 12-month heatmap that doubles as a day picker,
 * the panel for the day it picks (today until the visitor clicks
 * another), and the all-time fact cards under both. None of it reads
 * the range/metric controls, so it renders once per payload.
 */

import { mountHeatmap } from "../heatmap"
import {
  activeTotals,
  computeFacts,
  fillDaily,
  formatAgo,
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
  lastReport,
  levelScale,
  modelLabel,
  perHour,
  PLACEHOLDER_IDS,
  type Site,
  shiftDays,
} from "../tokens"
import { createDayPanel } from "./day"
import { type Icons, type Query, setCard } from "./dom"

/** A year of days, which is also the picker's range. */
const WINDOW_DAYS = 365

export function createActivity(q: Query, icons: Icons) {
  const grid = q(".heat-grid")
  const panel = createDayPanel(q, icons, () => select(null))

  let site: Site | null = null
  /** The picked day, or null for "whatever today is". A session-cached
   *  payload can be a day old, so following today beats pinning a date
   *  the visitor never chose. */
  let picked: string | null = null
  /** First day actually drawn — the grid shows as many trailing weeks as
   *  fit, so this is what keyboard navigation clamps against. */
  let first = ""

  const day = () => picked ?? site?.today ?? ""

  const paintSelection = () => {
    const chosen = day()
    for (const cell of grid?.querySelectorAll<HTMLElement>("[data-date]") ??
      []) {
      cell.toggleAttribute("data-selected", cell.dataset.date === chosen)
    }
  }

  /** Pick a day (null = back to today), clamped to what is on screen. */
  function select(date: string | null) {
    if (!site) return
    const clamped =
      date === null
        ? null
        : date < first
          ? first
          : date > site.today
            ? site.today
            : date
    picked = clamped === site.today ? null : clamped
    paintSelection()
    panel.render(site, day())
  }

  grid?.addEventListener("click", (event) => {
    const cell =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-date]")
        : null
    if (cell?.dataset.date) select(cell.dataset.date)
  })

  // A picker that only answers the mouse would put a third of the
  // dashboard behind a pointer. Left/right walk days, up/down weeks —
  // the grid's own axes — and Home returns to today.
  grid?.addEventListener("keydown", (event) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    if (event.key === "Home") {
      select(null)
    } else if (event.key in steps) {
      select(shiftDays(day(), steps[event.key]))
    } else {
      return
    }
    event.preventDefault()
  })

  const renderHeatmap = (loaded: Site) => {
    if (!grid) return
    const days = fillDaily(
      loaded.daily,
      shiftDays(loaded.today, -(WINDOW_DAYS - 1)),
      loaded.today,
    )
    // Quartile levels over the full year, so the fit-to-width slice
    // reads the same at any viewport. Days with messages but no token
    // metadata (early-2025 Cursor logs) render as hollow cells, level -1
    // in Heatmap.astro — real activity, unknown size.
    const level = levelScale(days)
    mountHeatmap(grid, days, (shown) => {
      first = shown[0].date
      const chosen = day()
      return shown.map((entry) => ({
        selected: entry.date === chosen,
        level: isMessagesOnly(entry) ? -1 : level(entry.tokens),
        title:
          entry.tokens > 0
            ? `${formatTokens(entry.tokens)} tokens on ${formatDate(entry.date)} · ${formatCostExact(entry.cost)} · ${formatCount(entry.messages)} ${entry.messages === 1 ? "message" : "messages"}${entry.active ? ` · ${formatDuration(entry.active)} active` : ""}`
            : isMessagesOnly(entry)
              ? `${formatCount(entry.messages)} ${entry.messages === 1 ? "message" : "messages"} on ${formatDate(entry.date)} · token counts unavailable`
              : `No usage on ${formatDate(entry.date)}`,
      }))
    })
  }

  /**
   * How long ago a machine last reported, i.e. how fresh these numbers
   * are — the same clock the device list shows. `generatedAt` is a
   * different one: the collector recomposes on every submission,
   * including the 80% that change nothing, so it would read "just now"
   * through an idle afternoon. It stays as the fallback for a payload
   * with no devices in it at all.
   */
  const renderSync = (loaded: Site) => {
    const meta = q(".tk-sync")
    if (!meta) return
    const seen = lastReport(loaded)
    const stamp = seen ?? Date.parse(loaded.generatedAt)
    meta.textContent = `${seen === null ? "collected" : "synced"} ${formatAgo(stamp)}`
    meta.title = `${formatDate(loaded.today)} · ${
      seen === null ? "collector last ran" : "last device report"
    } ${new Date(stamp).toLocaleString()}`
  }

  const render = (loaded: Site) => {
    site = loaded
    // A payload that moved on can strand a pick outside the window.
    if (picked !== null && (picked > loaded.today || picked < first)) {
      picked = null
    }
    renderSync(loaded)
    renderHeatmap(loaded)
    panel.render(loaded, day())
    renderFacts(q, loaded)
  }

  return { render }
}

function renderFacts(q: Query, site: Site) {
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
