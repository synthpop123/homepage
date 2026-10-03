/**
 * Runtime controller for the Switch section — Switch.astro owns the
 * markup, styles and skeletons, this module owns everything that runs in
 * the browser. One mount per <switch-feed> root: load the Switch section
 * of /misc stale-while-revalidate and render the all-time readout, the
 * heatmap and the catalog ranked by lifetime play time, or show the
 * fallback when nothing loads, and reload it when it may have gone stale.
 * A payload identical to the one on screen is not rendered again.
 */

import { calendarDay, keepFresh, settle, whenChanged } from "@/lib/client/feed"
import { drawSpark, SPARK_DAYS } from "@/lib/client/spark"
import {
  formatPlaytime,
  heatmapWindow,
  loadSite,
  type Site,
} from "@/lib/client/switch"
import { buildHeatmap, buildRow, fillStats } from "./render"

export function mountSwitch(feed: HTMLElement) {
  const endpoint = feed.dataset.endpoint
  const body = feed.querySelector<HTMLElement>(".switch-body")
  const list = feed.querySelector<HTMLOListElement>(".switch-list")
  const fallback = feed.querySelector<HTMLElement>(".switch-fallback")
  if (!endpoint || !body || !list) return

  const limit = Number(feed.dataset.limit) || 8

  // "Played today" counts from the reader's day, not the payload's: a
  // cached copy can be a day behind. The day is part of what is drawn,
  // so midnight redraws the rows even when no new payload comes.
  let last: Site | null = null
  const render = whenChanged<{ site: Site; today: string }>(
    ({ site, today }) => {
      if (site.games.length === 0 && site.activity.length === 0) {
        throw new Error("No play data")
      }

      fillStats(feed, site.stats)
      buildHeatmap(feed, site)
      drawSpark(
        "switch",
        heatmapWindow(site.activity, site.today, SPARK_DAYS).map(
          (day) => day.minutes,
        ),
        (minutes) => `${formatPlaytime(minutes)} played`,
      )

      const games = site.games.slice(0, limit)
      const max = Math.max(...games.map((game) => game.totalMinutes), 1)
      list.hidden = games.length === 0
      list.replaceChildren(
        ...games.map((game, i) =>
          buildRow(game, i + 1, max, site.recentDays, today),
        ),
      )
      settle(feed, body, fallback, true)
      last = site
    },
  )
  const draw = (site: Site) => render({ site, today: calendarDay() })

  loadSite(endpoint, draw).catch(() => settle(feed, body, fallback, false))

  // A failed reload keeps what is on screen; one after a failed first
  // load is what brings the section back.
  keepFresh({
    tick: () => {
      if (last) draw(last)
    },
    reload: () => loadSite(endpoint, draw).catch(() => {}),
  })
}
