/**
 * Runtime controller for the Music section — Music.astro owns the markup,
 * styles and skeletons, this module owns everything that runs in the
 * browser. One mount per <music-feed> root: load the Music section of
 * /misc stale-while-revalidate and render the all-time readout, the
 * heatmap and the last-played list, or show the fallback when nothing
 * loads, and reload it when it may have gone stale.
 */

import { keepFresh, settle, whenChanged } from "@/lib/client/feed"
import { loadSite, type Site } from "@/lib/client/music"
import { pauseOffscreen } from "@/lib/client/vinyl"
import { buildHeatmap, buildRow, fillStats, refreshTimes } from "./render"

export function mountMusic(feed: HTMLElement) {
  const endpoint = feed.dataset.endpoint
  const body = feed.querySelector<HTMLElement>(".music-body")
  const list = feed.querySelector<HTMLOListElement>(".music-list")
  const fallback = feed.querySelector<HTMLElement>(".music-fallback")
  if (!endpoint || !body || !list) return

  const limit = Number(feed.dataset.limit) || 10

  const spin = pauseOffscreen()

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
    spin.disconnect()
    const disc = list.querySelector(".disc")
    if (disc) spin.observe(disc)
    settle(feed, body, fallback, true)
  })

  loadSite(endpoint, render).catch(() => settle(feed, body, fallback, false))

  // "just now" is only true for a minute; the list only until the next
  // listen. A failed reload keeps what is on screen; one after a failed
  // first load is what brings the section back.
  keepFresh({
    tick: () => refreshTimes(list),
    reload: () => loadSite(endpoint, render).catch(() => {}),
  })
}
