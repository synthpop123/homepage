/**
 * Runtime controller for the Movies wall — Movies.astro owns the markup,
 * styles and skeletons, this module owns everything that runs in the
 * browser. One mount per <movies-feed> root: load the Movies section of
 * /misc stale-while-revalidate and replace the skeleton posters with the
 * latest diary entries, or show the fallback when nothing loads, and
 * reload it when it may have gone stale.
 */

import { live, settle, whenChanged } from "@/lib/client/feed"
import { loadSite, type Site } from "@/lib/client/movies"
import { buildCard } from "./render"

export function mountMovies(feed: HTMLElement) {
  const grid = feed.querySelector<HTMLOListElement>(".movies-grid")
  const fallback = feed.querySelector<HTMLElement>(".feed-fallback")
  const endpoint = feed.dataset.endpoint
  if (!grid || !endpoint) return

  const limit = Number(feed.dataset.limit) || 8

  const render = whenChanged<Site>((site) => {
    if (site.films.length === 0) throw new Error("No diary entries")
    const fragment = document.createDocumentFragment()
    for (const film of site.films.slice(0, limit))
      fragment.append(buildCard(film))
    grid.replaceChildren(fragment)
    settle(feed, grid, fallback, true)
  })

  live(() => loadSite(endpoint, render), {
    failed: () => settle(feed, grid, fallback, false),
  })
}
