/**
 * Runtime controller for the Memos feed — Memos.astro owns the markup,
 * styles and skeletons, this module owns everything that runs in the
 * browser. One mount per <memos-feed> root: load cf-workers-api's
 * /memos/site stale-while-revalidate and render the list — or one of the
 * two quiet states, which are different things: an account with nothing
 * to show is not a feed that failed. A cached paint and the revalidated
 * answer both go through `render`, which rebuilds the list whole.
 */

import { live } from "../feed"
import { loadSite, type Site, toMemo } from "../memos"
import { memoYear, renderMemo, renderYear } from "./render"

export function mountMemos(root: HTMLElement) {
  const list = root.querySelector<HTMLOListElement>(".memos-list")
  const empty = root.querySelector<HTMLElement>(".memos-empty")
  const fallback = root.querySelector<HTMLElement>(
    ".feed-fallback:not(.memos-empty)",
  )
  const { endpoint } = root.dataset
  if (!endpoint || !list) return

  /** Exactly one of the list and the two quiet states is on screen. */
  const show = (state: HTMLElement | null) => {
    list.hidden = state !== list
    if (empty) empty.hidden = state !== empty
    if (fallback) fallback.hidden = state !== fallback
    root.setAttribute("aria-busy", "false")
  }

  let shown = ""
  const render = (site: Site) => {
    // The revalidated answer is usually the payload already on screen.
    const text = JSON.stringify(site.memos)
    if (text === shown) return
    if (site.memos.length === 0) {
      show(empty)
    } else {
      // Newest first, so a year's marker goes in ahead of its first memo.
      const fragment = document.createDocumentFragment()
      let year = ""
      for (const memo of site.memos.map(toMemo)) {
        const next = memoYear(memo)
        if (next !== year) fragment.append(renderYear(next))
        year = next
        fragment.append(renderMemo(memo))
      }
      list.replaceChildren(fragment)
      show(list)
    }
    // Only once drawn: a render that threw must not block the next try.
    shown = text
  }

  live(() => loadSite(endpoint, render), { failed: () => show(fallback) })
}
