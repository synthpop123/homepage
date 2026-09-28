/**
 * The Switch section's pieces: the all-time readout, the heatmap padded
 * to its full window, and one row of the most-played list.
 */

import { el } from "@/lib/client/dom"
import { dayInstant, monthDay, safeHttpUrl } from "@/lib/client/feed"
import { HEAT_MAX_WEEKS, mountHeatmap } from "@/lib/client/heatmap"
import { setReadout } from "@/lib/client/readout"
import {
  formatPlaytime,
  heatmapWindow,
  rowFoot,
  type Site,
  type SiteGame,
  statCards,
} from "@/lib/client/switch"

const numberFormatter = new Intl.NumberFormat("en-US")

export const fillStats = (feed: HTMLElement, stats: Site["stats"]) => {
  const cards = statCards(stats)
  feed.querySelectorAll<HTMLElement>(".stat").forEach((stat, index) => {
    const card = cards[index]
    const label = stat.querySelector<HTMLElement>(".label")
    const value = stat.querySelector<HTMLElement>(".value")
    if (!card || !label || !value) return
    label.textContent = card.label
    setReadout(value, card.value)
    stat.title = card.note
  })
}

export const buildHeatmap = (feed: HTMLElement, site: Site) => {
  const grid = feed.querySelector<HTMLElement>(".heat-grid")
  if (!grid) return

  const days = heatmapWindow(site.activity, site.today, HEAT_MAX_WEEKS * 7)
  mountHeatmap(grid, days, (shown) => {
    const max = Math.max(...shown.map((day) => day.minutes), 1)
    return shown.map((day) => ({
      level:
        day.minutes === 0 ? 0 : Math.max(1, Math.ceil((day.minutes / max) * 4)),
      title: `${day.minutes === 0 ? "No play" : formatPlaytime(day.minutes)} on ${monthDay.format(dayInstant(day.date))}`,
    }))
  })
}

/**
 * One title, and one bar of a chart: the row's own background is the
 * bar. Its fill runs to the title's share of the most-played one, and
 * the part of that inside the recent window is drawn in the heatmap's
 * green — the same "played lately" the grid above says in cells. So the
 * list reads as a ranking, a chart and a recency check at once, in one
 * line per game.
 */
export const buildRow = (
  game: SiteGame,
  rank: number,
  max: number,
  recentDays: number,
  today: string,
) => {
  const row = el("li", "switch-item")
  // Both fills are measured against the same maximum, so the green part
  // is literally a slice of the bar it sits inside.
  row.style.setProperty("--total", `${(game.totalMinutes / max) * 100}%`)
  row.style.setProperty("--recent", `${(game.recentMinutes / max) * 100}%`)

  const cover = el("span", "cover")
  const src = safeHttpUrl(game.imageUrl)
  if (src) {
    const img = document.createElement("img")
    img.src = src
    img.alt = ""
    img.loading = "lazy"
    img.decoding = "async"
    img.width = 112
    img.height = 112
    cover.append(img)
  }

  const title = el("span", "title", game.title)
  title.title = game.title
  const meta = el("span", "meta")
  meta.append(title, el("span", "sub", rowFoot(game, recentDays, today)))

  const amount = el("span", "amount", formatPlaytime(game.totalMinutes))
  amount.title = `${numberFormatter.format(game.totalMinutes)} minutes`

  row.append(
    el("span", "rank", String(rank).padStart(2, "0")),
    cover,
    meta,
    amount,
  )

  const shop = safeHttpUrl(game.shopUrl)
  if (shop) {
    const link = document.createElement("a")
    link.className = "shop"
    link.href = shop
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    link.setAttribute("aria-label", `${game.title} on the eShop`)
    row.append(link)
  }
  return row
}
