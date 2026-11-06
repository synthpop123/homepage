/**
 * Runtime controller for the Portfolio section — Portfolio.astro owns the
 * markup, styles and skeletons, this module owns everything that runs in
 * the browser. One mount per <portfolio-feed> root: load the Portfolio section
 * of /misc stale-while-revalidate, and draw the chosen account over the
 * chosen range — the hero figure, the ink line with the benchmark's
 * ghost, the strip of returns, the readout, the allocation bar and the
 * holdings, any of which opens into its own price line in place.
 *
 * The pickers and an open row survive a refreshed payload, and a payload
 * identical to the one on screen is not drawn again.
 */

import {
  dayInstant,
  keepFresh,
  monthDay,
  settle,
  whenChanged,
} from "@/lib/client/feed"
import {
  change,
  DEFAULT_RANGE,
  formatReturn,
  heroNote,
  loadSite,
  type Range,
  type Row,
  type Site,
  view,
} from "@/lib/client/portfolio"
import { type Chart, drawChart } from "./chart"
import {
  buildAllocation,
  buildCashRow,
  buildRow,
  buildStrip,
  fillKicker,
  fillPanel,
  fillReadout,
  syncButtons,
} from "./render"

export function mountPortfolio(feed: HTMLElement) {
  const endpoint = feed.dataset.endpoint
  const body = feed.querySelector<HTMLElement>(".portfolio-body")
  const fallback = feed.querySelector<HTMLElement>(".portfolio-fallback")
  const accounts = feed.querySelector<HTMLElement>(".portfolio-accounts")
  const ranges = feed.querySelector<HTMLElement>(".portfolio-ranges")
  const kicker = feed.querySelector<HTMLElement>(".portfolio-kicker")
  const figure = feed.querySelector<HTMLElement>(".portfolio-figure")
  const note = feed.querySelector<HTMLElement>(".portfolio-note")
  const svg = feed.querySelector<SVGSVGElement>(".portfolio-chart")
  const list = feed.querySelector<HTMLOListElement>(".portfolio-list")
  if (
    !endpoint ||
    !body ||
    !accounts ||
    !ranges ||
    !kicker ||
    !figure ||
    !note ||
    !svg ||
    !list
  ) {
    return
  }

  const state: {
    account: string
    range: Range
    open: string | null
    openRange: Range
  } = {
    account: "all",
    range: DEFAULT_RANGE,
    open: null,
    openRange: DEFAULT_RANGE,
  }
  let site: Site | null = null
  let rows: Row[] = []
  let pinSegment: (symbol: string | null) => void = () => {}

  /** The open row's panel, filled for the state's range. */
  const openPanel = () => {
    if (!site || !state.open) return
    const item = list.querySelector<HTMLElement>(
      `.holding[data-symbol="${CSS.escape(state.open)}"]`,
    )
    const button = item?.querySelector<HTMLButtonElement>(".holding-row")
    const panel = item?.querySelector<HTMLElement>(".holding-panel")
    const row = rows.find((entry) => entry.symbol === state.open)
    if (!item || !button || !panel || !row) {
      state.open = null
      pinSegment(null)
      return
    }
    button.setAttribute("aria-expanded", "true")
    item.dataset.open = ""
    panel.hidden = false
    fillPanel(panel, site, row, state.openRange, (range) => {
      state.openRange = range
      openPanel()
    })
    pinSegment(state.open)
  }

  const closePanel = () => {
    const item = state.open
      ? list.querySelector<HTMLElement>(
          `.holding[data-symbol="${CSS.escape(state.open)}"]`,
        )
      : null
    item?.querySelector(".holding-row")?.setAttribute("aria-expanded", "false")
    item?.removeAttribute("data-open")
    const panel = item?.querySelector<HTMLElement>(".holding-panel")
    if (panel) panel.hidden = true
    state.open = null
    pinSegment(null)
  }

  /** Everything that depends on the account and range. */
  const draw = () => {
    if (!site) return
    const current = site
    const resolved = view(current, state.account, state.range)
    state.account = resolved.account.id
    state.range = resolved.range

    syncButtons(
      accounts,
      current.accounts.map((account) => ({
        key: account.id,
        label: account.id === "all" ? "All" : account.name,
        icon: account.logo,
      })),
      state.account,
      (key) => {
        state.account = key
        draw()
      },
    )
    syncButtons(
      ranges,
      resolved.ranges.map((key) => ({ key, label: key })),
      state.range,
      (key) => {
        // An open row follows the section's range when it changes.
        state.range = key as Range
        state.openRange = key as Range
        draw()
      },
    )

    const { start, label } = resolved
    const values = resolved.line
    const ghost = resolved.ghost ?? undefined

    fillKicker(kicker, current, resolved.account.id)
    const hero = (at: number | null) => {
      const end = at === null ? values.length - 1 : at
      figure.textContent = formatReturn(change(values, 0, end) ?? 0)
      note.textContent = heroNote(
        current,
        start,
        label,
        at === null ? null : start + at,
      )
    }
    hero(null)

    let light: (index: number | null) => void = () => {}
    let chart: Chart | null = null
    light = buildStrip(feed, current, resolved.growth, start, (index) => {
      const at = index === null ? null : index - start
      chart?.scrub(at)
      hero(at)
      light(index)
    })
    svg.setAttribute("aria-label", `${resolved.account.name}, ${label}`)
    chart = drawChart(svg, {
      values,
      ghost,
      ghostLabel: current.benchmark.label,
      describe: (i) =>
        `${monthDay.format(dayInstant(current.days[start + i]))}: ${formatReturn(change(values, 0, i) ?? 0)}`,
      dateOf: (i) => monthDay.format(dayInstant(current.days[start + i])),
      onScrub: (at) => {
        hero(at)
        light(at === null ? null : start + at)
      },
    })

    fillReadout(feed, resolved.cards)
    pinSegment = buildAllocation(feed, resolved.rows, resolved.cash)

    rows = resolved.rows
    const rangeHead = feed.querySelector(".portfolio-head .holding-spark")
    if (rangeHead) rangeHead.textContent = resolved.range
    list.replaceChildren(
      ...resolved.rows.map((row) => buildRow(current, row, start)),
      ...resolved.cash.map(buildCashRow),
    )
    if (state.open) openPanel()
  }

  list.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button.holding-row",
    )
    const symbol = button?.closest<HTMLElement>(".holding")?.dataset.symbol
    if (!button || !symbol) return
    const wasOpen = state.open === symbol
    closePanel()
    if (wasOpen) return
    state.open = symbol
    state.openRange = state.range
    openPanel()
  }
  list.onpointerover = (event) => {
    const symbol = (event.target as HTMLElement).closest<HTMLElement>(
      ".holding",
    )?.dataset.symbol
    feed.querySelectorAll<HTMLElement>(".alloc-seg").forEach((segment) => {
      segment.toggleAttribute(
        "data-hover",
        symbol !== undefined && segment.dataset.symbol === symbol,
      )
    })
  }
  list.onpointerleave = () => {
    feed.querySelectorAll(".alloc-seg[data-hover]").forEach((segment) => {
      segment.removeAttribute("data-hover")
    })
  }

  const render = whenChanged<Site>((next) => {
    site = next
    draw()
    settle(feed, body, fallback, true)
  })

  // Charts are drawn in pixels: a new width is a redraw.
  let width = 0
  new ResizeObserver(() => {
    const now = svg.clientWidth
    if (now === width) return
    width = now
    if (site) draw()
  }).observe(svg)

  loadSite(endpoint, render).catch(() => settle(feed, body, fallback, false))

  keepFresh({
    reload: () => loadSite(endpoint, render).catch(() => {}),
  })
}
