/**
 * Runtime controller for the Memos feed — Memos.astro owns the markup,
 * styles and skeletons, this module owns everything that runs in the
 * browser. One mount per <memos-feed> root: load cf-workers-api's
 * /memos/site stale-while-revalidate and render the list — or one of the
 * two quiet states, which are different things: an account with nothing
 * to show is not a feed that failed. A cached paint and the revalidated
 * answer both go through `render`, which rebuilds the list whole.
 */

import { loadSite, type Site, toMemo } from "../memos"
import { memoYear, renderMemo, renderYear } from "./render"

export function mountMemos(root: HTMLElement) {
  const list = root.querySelector<HTMLOListElement>(".memos-list")
  const empty = root.querySelector<HTMLElement>(".memos-empty")
  const fallback = root.querySelector<HTMLElement>(".memos-fallback")
  const { endpoint } = root.dataset
  if (!endpoint || !list) return

  const done = () => root.setAttribute("aria-busy", "false")
  const show = (message: HTMLElement | null) => {
    list.hidden = true
    if (message) message.hidden = false
    done()
  }

  let shown = ""
  const render = (site: Site) => {
    // The revalidated answer is usually the payload already on screen.
    const text = JSON.stringify(site.memos)
    if (text === shown) return
    shown = text
    if (empty) empty.hidden = true
    if (site.memos.length === 0) {
      show(empty)
      return
    }
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
    list.hidden = false
    done()
  }

  loadSite(endpoint, render).catch(() => show(fallback))
}
