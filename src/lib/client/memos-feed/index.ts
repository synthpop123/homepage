/**
 * Runtime controller for the Memos feed — Memos.astro owns the markup,
 * styles and skeletons, this module owns everything that runs in the
 * browser. One mount per <memos-feed> root: fetch the account's public
 * statuses through the shared session cache, normalize them, and render
 * the list — or one of the two quiet states, which are different
 * things: an account with nothing to show is not a feed that failed.
 */

import { cached, fetchJson } from "../feed"
import { isStatusList, type MastodonStatus, toMemo } from "../memos"
import { renderMemo } from "./render"

export function mountMemos(root: HTMLElement) {
  const list = root.querySelector<HTMLOListElement>(".memos-list")
  const empty = root.querySelector<HTMLElement>(".memos-empty")
  const fallback = root.querySelector<HTMLElement>(".memos-fallback")
  const { instance, accountId } = root.dataset
  if (!instance || !accountId || !list) return

  const limit = Number(root.dataset.limit) || 20
  const done = () => root.setAttribute("aria-busy", "false")
  const show = (message: HTMLElement | null) => {
    list.hidden = true
    if (message) message.hidden = false
    done()
  }

  cached(
    `memos:${instance}:${accountId}:${limit}`,
    () =>
      fetchJson<MastodonStatus[]>(
        `${instance}/api/v1/accounts/${accountId}/statuses?exclude_replies=true&exclude_reblogs=true&limit=${limit}`,
      ),
    isStatusList,
  )
    .then((statuses) => {
      const memos = statuses.flatMap((status) => {
        const memo = toMemo(status)
        return memo ? [memo] : []
      })
      if (memos.length === 0) {
        show(empty)
        return
      }
      const fragment = document.createDocumentFragment()
      for (const memo of memos) fragment.append(renderMemo(memo))
      list.replaceChildren(fragment)
      done()
    })
    .catch(() => show(fallback))
}
