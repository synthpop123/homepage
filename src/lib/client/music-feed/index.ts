/**
 * Runtime controller for the Music section — Music.astro owns the markup,
 * styles and skeletons, this module owns everything that runs in the
 * browser. One mount per <music-feed> root: load the Music section of
 * /misc stale-while-revalidate and render the all-time readout, the
 * heatmap and the last-played list, or show the fallback when nothing
 * loads, and reload it when it may have gone stale.
 */

import { live, settle, whenChanged } from "@/lib/client/feed"
import { loadSite, type Site } from "@/lib/client/music"
import { buildHeatmap, buildRow, fillStats, refreshTimes } from "./render"

export function mountMusic(feed: HTMLElement) {
  const endpoint = feed.dataset.endpoint
  const body = feed.querySelector<HTMLElement>(".music-body")
  const list = feed.querySelector<HTMLOListElement>(".music-list")
  const fallback = feed.querySelector<HTMLElement>(".feed-fallback")
  if (!endpoint || !body || !list) return

  const limit = Number(feed.dataset.limit) || 10

  // Cached and refreshed payloads land in the same renderer, which
  // replaces rather than appends, and skips one already on screen.
  const render = whenChanged<Site>((site) => {
    if (site.listens.length === 0) throw new Error("No listens")
    fillStats(feed, site.stats)
    buildHeatmap(feed, site.activity)
    const fragment = document.createDocumentFragment()
    site.listens
      .slice(0, limit)
      .forEach((listen, i) => fragment.append(buildRow(listen, i === 0)))
    list.replaceChildren(fragment)
    settle(feed, body, fallback, true)
  })

  // "just now" is only true for a minute; the list only until the next
  // listen.
  live(() => loadSite(endpoint, render), {
    failed: () => settle(feed, body, fallback, false),
    tick: () => refreshTimes(list),
  })
}
