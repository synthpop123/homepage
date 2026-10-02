/**
 * Activity section: a 12-month heatmap that doubles as a day picker and
 * the panel for the day it picks (today until the visitor clicks
 * another). Neither reads the range/metric controls, so the section
 * renders once per payload.
 */

import { relativeTime } from "../feed"
import { mountHeatmap, stepDay } from "../heatmap"
import {
  fillDaily,
  formatCostExact,
  formatCount,
  formatDate,
  formatDuration,
  formatTokens,
  isMessagesOnly,
  lastReport,
  levelScale,
  type Site,
  shiftDays,
} from "../tokens"
import { createDayPanel } from "./day"
import type { Icons, Query } from "./dom"

/** A year of days, which is also the picker's range. */
const WINDOW_DAYS = 365

export function createActivity(q: Query, icons: Icons) {
  const grid = q(".heat-grid")
  const status = q(".heat-status")
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

  /** Says the picked day and its figures, since the only other sign of
   *  a pick is the ring drawn around its cell. */
  const announce = () => {
    const cell = grid?.querySelector<HTMLElement>("[data-selected]")
    if (status && cell) status.textContent = cell.title
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
    if (!cell?.dataset.date) return
    select(cell.dataset.date)
    announce()
  })

  // A picker that only answers the mouse would put a third of the
  // dashboard behind a pointer. The arrows follow the grid's own axes
  // (up/down a day, left/right a week) and Home returns to today.
  grid?.addEventListener("keydown", (event) => {
    if (!site || event.altKey || event.ctrlKey || event.metaKey) return
    const next = stepDay(day(), event.key, first, site.today)
    if (next === null) return
    event.preventDefault()
    select(next)
    announce()
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
    meta.textContent = `${seen === null ? "collected" : "synced"} ${relativeTime(stamp)}`
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
  }

  return {
    render,
    /** The sync age is relative to now, and the day panel's "Today"
     *  to the reader's day, so both repaint on the minute. */
    tick: () => {
      if (site) renderSync(site)
      panel.relabel()
    },
  }
}
