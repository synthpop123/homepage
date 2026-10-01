/**
 * Runtime controller for the Switch section — Switch.astro owns the
 * markup, styles and skeletons, this module owns everything that runs in
 * the browser. One mount per <switch-feed> root: load the Switch section
 * of /misc stale-while-revalidate and render the all-time readout, the
 * heatmap and the catalog ranked by lifetime play time, or show the
 * fallback when nothing loads, and reload it when it may have gone stale.
 * A payload identical to the one on screen is not rendered again.
 */

import { keepFresh, whenChanged } from "@/lib/client/feed"
import { loadSite, type Site } from "@/lib/client/switch"
import { buildHeatmap, buildRow, fillStats } from "./render"

export function mountSwitch(feed: HTMLElement) {
  const endpoint = feed.dataset.endpoint
  const body = feed.querySelector<HTMLElement>(".switch-body")
  const list = feed.querySelector<HTMLOListElement>(".switch-list")
  const fallback = feed.querySelector<HTMLElement>(".switch-fallback")
  if (!endpoint || !body || !list) return

  const limit = Number(feed.dataset.limit) || 8

  const render = whenChanged<Site>((site) => {
    if (site.games.length === 0 && site.activity.length === 0) {
      throw new Error("No play data")
    }

    fillStats(feed, site.stats)
    buildHeatmap(feed, site)

    const games = site.games.slice(0, limit)
    const max = Math.max(...games.map((game) => game.totalMinutes), 1)
    list.hidden = games.length === 0
    list.replaceChildren(
      ...games.map((game, i) =>
        buildRow(game, i + 1, max, site.recentDays, site.today),
      ),
    )
    feed.setAttribute("aria-busy", "false")
  })

  loadSite(endpoint, render).catch(() => {
    body.hidden = true
    if (fallback) fallback.hidden = false
    feed.setAttribute("aria-busy", "false")
  })

  // A failed reload keeps what is on screen.
  keepFresh({ reload: () => loadSite(endpoint, render).catch(() => {}) })
}
