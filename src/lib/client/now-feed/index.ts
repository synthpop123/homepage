/**
 * Runtime controller for the home page's Now bento — Now.astro owns the
 * markup, styles and skeletons, this module owns everything that runs in
 * the browser. One mount per <now-feed> root: load `/now/site`
 * stale-while-revalidate into the four tiles, repaint them on the minute
 * and reload when the payload may have gone stale.
 */

import { calendarDay, keepFresh } from "@/lib/client/feed"
import { loadSite, type Site } from "@/lib/client/now"
import {
  renderFilm,
  renderListen,
  renderPortfolio,
  renderTokens,
} from "./render"

export function mountNow(feed: HTMLElement) {
  const endpoint = feed.dataset.endpoint
  if (!endpoint) return
  const tile = (name: string) =>
    feed.querySelector<HTMLElement>(`[data-tile="${name}"]`)!

  let last: Site | null = null
  const render = (site: Site) => {
    // Relative days count from the reader's today, not the payload's:
    // a cached copy can be a day behind.
    const now = Date.now()
    const today = calendarDay(now)
    renderListen(tile("listen"), site, now)
    renderFilm(tile("film"), site, today)
    renderTokens(tile("tokens"), site, today)
    renderPortfolio(tile("portfolio"), site)
    feed.setAttribute("aria-busy", "false")
    // A section that stepped aside on a failed first load comes back.
    feed.closest("section")?.removeAttribute("hidden")
    last = site
  }

  loadSite(endpoint, render).catch(() => {
    // Nothing cached and nothing answered: a home page has no reason to
    // explain a backend, so the section steps aside.
    feed.closest("section")?.setAttribute("hidden", "")
  })

  // "3m ago" is only true for a minute, and a payload only for its day:
  // repaint on the minute, and ask again when the tab comes back or
  // midnight passes. A failed refresh keeps what is on screen.
  keepFresh({
    tick: () => {
      if (last) render(last)
    },
    reload: () => {
      loadSite(endpoint, render).catch(() => {})
    },
  })
}
