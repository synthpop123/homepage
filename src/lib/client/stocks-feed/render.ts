/**
 * The Stocks section's pieces: the account and range pickers, the strip
 * of returns under the chart, the readout, the allocation bar, and the
 * holdings table with the panel a row opens: its price line against its
 * cost, what it is, and how it has done. Every figure and
 * decision comes from `stocks.ts`; this file only builds DOM.
 */

import { el } from "@/lib/client/dom"
import { dayInstant, monthDay, safeHttpUrl } from "@/lib/client/feed"
import { setReadout } from "@/lib/client/readout"
import {
  change,
  direction,
  formatDay,
  formatPrice,
  formatPriceChange,
  formatReturn,
  formatWeight,
  grainFor,
  holdingFacts,
  type PriceBand,
  priceView,
  type Range,
  type ReadoutCard,
  type Row,
  type Site,
  type SiteCash,
  type StripCell,
  stripCells,
} from "@/lib/client/stocks"
import usdFlag from "@/assets/flags/USD.png?url"
import { type Chart, drawChart, sparkline } from "./chart"

/** Flags for cash, by currency: a square the logo tile crops. */
const CASH_FLAGS: Record<string, string> = { USD: usdFlag }

/**
 * A row of toggle buttons kept in place across renders: a button whose
 * key is still offered keeps its node (and its focus), and only
 * `aria-pressed` moves.
 */
export function syncButtons(
  group: HTMLElement,
  items: {
    key: string
    label: string
    count?: string
    /** A mark before the label (a broker's logo), decorative. */
    icon?: string | null
  }[],
  pressed: string,
  onPick: (key: string) => void,
) {
  const existing = new Map(
    [...group.querySelectorAll<HTMLButtonElement>("button")].map((button) => [
      button.dataset.key ?? "",
      button,
    ]),
  )
  const buttons = items.map(({ key, label, count, icon }) => {
    let button = existing.get(key)
    if (!button) {
      button = el("button") as HTMLButtonElement
      button.type = "button"
      button.dataset.key = key
      const src = safeHttpUrl(icon)
      if (src) {
        const img = document.createElement("img")
        img.src = src
        img.alt = ""
        img.width = 32
        img.height = 32
        img.decoding = "async"
        img.onerror = () => img.remove()
        button.append(img)
      }
    }
    const name = button.querySelector(":scope > span") ?? el("span")
    name.textContent = label
    const mark = button.querySelector(":scope > img")
    button.replaceChildren(
      ...(mark ? [mark] : []),
      name,
      ...(count ? [el("small", "", count)] : []),
    )
    button.setAttribute("aria-pressed", String(key === pressed))
    button.onclick = () => {
      if (key !== pressed) onPick(key)
    }
    return button
  })
  group.replaceChildren(...buttons)
  group.removeAttribute("aria-busy")
}

/**
 * The line over the hero figure: the brokers' marks, then whose figure it
 * is. On all accounts the marks sit fanned in a short overlapping deck;
 * picking one account folds the others away, so the switch reads as the
 * deck closing on one card. Tiles persist across draws so that moves.
 */
export function fillKicker(kicker: HTMLElement, site: Site, accountId: string) {
  let deck = kicker.querySelector<HTMLElement>(".broker-deck")
  let name = kicker.querySelector<HTMLElement>(".kicker-name")
  if (!deck || !name) {
    deck = el("span", "broker-deck")
    deck.setAttribute("aria-hidden", "true")
    name = el("span", "kicker-name")
    kicker.replaceChildren(deck, name)
  }
  const brokers = site.accounts.filter((account) => account.id !== "all")
  const tiles = new Map(
    [...deck.querySelectorAll<HTMLElement>(".broker")].map((tile) => [
      tile.dataset.id ?? "",
      tile,
    ]),
  )
  deck.replaceChildren(
    ...brokers.map((account) => {
      let tile = tiles.get(account.id)
      if (!tile) {
        tile = el("span", "broker")
        tile.dataset.id = account.id
        tile.dataset.monogram = account.name.slice(0, 1)
        const src = safeHttpUrl(account.logo)
        if (src) {
          const img = document.createElement("img")
          img.src = src
          img.alt = ""
          img.width = 48
          img.height = 48
          img.decoding = "async"
          img.onerror = () => img.remove()
          tile.append(img)
        }
      }
      tile.toggleAttribute(
        "data-folded",
        accountId !== "all" && account.id !== accountId,
      )
      tile.title = account.name
      return tile
    }),
  )
  const account = site.accounts.find((entry) => entry.id === accountId)
  name.textContent =
    accountId === "all" ? "All accounts" : (account?.name ?? "")
}

/** The cells under the chart; returns the hook the chart's scrubber
 *  calls to light the cell it is in. */
export function buildStrip(
  feed: HTMLElement,
  site: Site,
  series: (number | null)[],
  start: number,
  onCell: (index: number | null) => void,
): (index: number | null) => void {
  const row = feed.querySelector<HTMLElement>(".strip-cells")
  if (!row) return () => {}
  const sessions = site.days.length - 1 - start
  const grain = grainFor(sessions)
  const cells: StripCell[] = stripCells(site.days, series, start, grain)
  row.replaceChildren(
    ...cells.map((cell) => {
      const node = el("span", "strip-cell")
      node.dataset.level = String(cell.level)
      node.dataset.dir = direction(cell.change)
      node.title = cell.title
      return node
    }),
  )
  row.onpointerover = (event) => {
    const target = event.target as HTMLElement
    const at = [...row.children].indexOf(target)
    if (at >= 0) onCell(cells[at].to)
  }
  row.onpointerleave = () => onCell(null)
  return (index) => {
    row.querySelector("[data-on]")?.removeAttribute("data-on")
    if (index === null) return
    const at = cells.findIndex((cell) => index >= cell.from && index <= cell.to)
    row.children[at]?.setAttribute("data-on", "")
  }
}

export function fillReadout(feed: HTMLElement, cards: ReadoutCard[]) {
  feed
    .querySelectorAll<HTMLElement>(".stocks-readout .stat")
    .forEach((stat, i) => {
      const card = cards[i]
      const label = stat.querySelector<HTMLElement>(".label")
      const value = stat.querySelector<HTMLElement>(".value")
      const note = stat.querySelector<HTMLElement>(".note")
      if (!card || !label || !value || !note) return
      label.textContent = card.label
      setReadout(value, card.value)
      value.dataset.dir = card.value.startsWith("−") ? "down" : "up"
      note.textContent = card.note
    })
}

/** The allocation bar and its caption; returns the hook a row uses to
 *  light its own segment. */
export function buildAllocation(
  feed: HTMLElement,
  rows: Row[],
  cash: SiteCash[],
): (symbol: string | null) => void {
  const bar = feed.querySelector<HTMLElement>(".alloc-bar")
  const left = feed.querySelector<HTMLElement>(".alloc-what")
  const right = feed.querySelector<HTMLElement>(".alloc-share")
  if (!bar || !left || !right) return () => {}

  const rest = () => {
    left.textContent = "Allocation"
    right.textContent = `${rows.length} holding${rows.length === 1 ? "" : "s"}`
  }
  const segments = rows.map((row, i) => {
    const segment = el("span", "alloc-seg")
    segment.style.flexGrow = String(row.weight)
    // Heaviest darkest, fading down the list, never quite to nothing.
    segment.style.setProperty("--shade", `${Math.max(18, 88 - i * 11)}%`)
    segment.dataset.symbol = row.symbol
    return segment
  })
  for (const entry of cash) {
    const segment = el("span", "alloc-seg alloc-cash")
    segment.style.flexGrow = String(entry.weight)
    segment.dataset.symbol = cashKey(entry.currency)
    segments.push(segment)
  }
  bar.replaceChildren(...segments)

  let pinned: string | null = null
  const show = (symbol: string | null) => {
    const shown = symbol ?? pinned
    for (const segment of segments) {
      segment.toggleAttribute(
        "data-on",
        shown !== null && segment.dataset.symbol === shown,
      )
    }
    if (symbol === null) return rest()
    const row = rows.find((entry) => entry.symbol === symbol)
    const money = cash.find((entry) => cashKey(entry.currency) === symbol)
    left.textContent = row
      ? `${row.symbol} · ${row.name}`
      : `Cash · ${money?.currency ?? ""}`
    right.textContent = formatWeight(row?.weight ?? money?.weight ?? 0)
  }
  bar.onpointerover = (event) => {
    const symbol = (event.target as HTMLElement).dataset.symbol
    if (symbol !== undefined) show(symbol)
  }
  bar.onpointerleave = () => show(null)
  rest()
  return (symbol) => {
    pinned = symbol
    show(null)
  }
}

const logo = (row: { symbol: string; logo: string | null }) => {
  const mark = el("span", "stock-logo")
  const src = safeHttpUrl(row.logo)
  if (src) {
    const img = document.createElement("img")
    img.src = src
    img.alt = ""
    img.width = 56
    img.height = 56
    img.loading = "lazy"
    img.decoding = "async"
    // A logo that fails to load gives way to the monogram under it.
    img.onerror = () => img.remove()
    mark.append(img)
  }
  mark.dataset.monogram = row.symbol.replace(/[^A-Z0-9]/g, "").slice(0, 2)
  return mark
}

export function buildRow(
  site: Site,
  row: Row,
  rangeStart: number,
): HTMLLIElement {
  const item = el("li", "stock") as HTMLLIElement
  item.dataset.symbol = row.symbol

  const button = el("button", "stock-row") as HTMLButtonElement
  button.type = "button"
  button.setAttribute("aria-expanded", "false")
  const panelId = `stock-${row.symbol.replace(/[^\w-]/g, "_")}`
  button.setAttribute("aria-controls", panelId)

  const name = el("span", "stock-name")
  const sub = el("span", "stock-sub", row.name)
  sub.title = row.name
  name.append(el("span", "stock-ticker", row.symbol), sub)

  const entry = site.symbols.find((symbol) => symbol.symbol === row.symbol)
  const closes = (
    entry?.closes.slice(Math.max(row.start, rangeStart)) ?? []
  ).filter((value): value is number => value !== null)
  // The line is the ticker over the range; the figure is the position's
  // own return since it was bought, so each is coloured by its own sign.
  const spark = sparkline(closes, "stock-spark")
  spark.dataset.dir = direction(
    closes.length > 1 ? closes[closes.length - 1] / closes[0] - 1 : null,
  )

  const price = el(
    "span",
    "stock-price",
    row.price === null ? "—" : formatPrice(row.price, row.currency),
  )
  const costText = row.cost === null ? "—" : formatPrice(row.cost, row.currency)
  // Narrow screens fold the cost column under the price.
  price.append(el("span", "stock-cost-under", `cost ${costText}`))
  const cost = el("span", "stock-cost", costText)
  const weight = el("span", "stock-weight", formatWeight(row.weight))
  const result = el(
    "span",
    "stock-change",
    row.performance === null ? "—" : formatReturn(row.performance, 1),
  )
  result.dataset.dir = direction(row.performance)
  result.title = "Return on the position since it was bought"

  button.append(logo(row), name, spark, price, cost, weight, result)
  button.setAttribute(
    "aria-label",
    `${row.symbol}, ${row.name}: ${row.price === null ? "" : `${formatPrice(row.price, row.currency)}, `}${row.cost === null ? "" : `cost ${costText}, `}${formatWeight(row.weight)} of the account, ${row.performance === null ? "return unknown" : `${formatReturn(row.performance, 1)} on the position`}`,
  )

  const panel = el("div", "stock-panel")
  panel.id = panelId
  panel.hidden = true
  item.append(button, panel)
  return item
}

const SVG_NS = "http://www.w3.org/2000/svg"

/** The allocation bar's key for cash in a currency (never a ticker). */
const cashKey = (currency: string) => `cash:${currency}`

/** Lucide's banknote, for cash in a currency with no flag here. */
const cashIcon = () => {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("aria-hidden", "true")
  const rect = document.createElementNS(SVG_NS, "rect")
  for (const [key, value] of Object.entries({
    width: 20,
    height: 12,
    x: 2,
    y: 6,
    rx: 2,
  })) {
    rect.setAttribute(key, String(value))
  }
  const coin = document.createElementNS(SVG_NS, "circle")
  coin.setAttribute("cx", "12")
  coin.setAttribute("cy", "12")
  coin.setAttribute("r", "2")
  const ends = document.createElementNS(SVG_NS, "path")
  ends.setAttribute("d", "M6 12h.01M18 12h.01")
  svg.append(rect, coin, ends)
  return svg
}

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" })

/** One row per currency of cash, marked with its flag. */
export function buildCashRow(entry: SiteCash): HTMLLIElement {
  const item = el("li", "stock stock-cash") as HTMLLIElement
  const row = el("div", "stock-row")
  const mark = el("span", "stock-logo stock-logo-cash")
  const flag = CASH_FLAGS[entry.currency]
  if (flag) {
    const img = document.createElement("img")
    img.src = flag
    img.alt = ""
    img.width = 64
    img.height = 64
    img.decoding = "async"
    mark.append(img)
  } else mark.append(cashIcon())
  const name = el("span", "stock-name")
  let label = entry.currency
  try {
    label = currencyNames.of(entry.currency) ?? entry.currency
  } catch {}
  name.append(
    el("span", "stock-ticker", "Cash"),
    el("span", "stock-sub", label),
  )
  row.append(
    mark,
    name,
    el("span", "stock-spark"),
    el("span", "stock-price"),
    el("span", "stock-cost"),
    el("span", "stock-weight", formatWeight(entry.weight)),
    el("span", "stock-change"),
  )
  item.dataset.symbol = cashKey(entry.currency)
  item.append(row)
  return item
}

/** The year's low to high, with the price on it and the cost marked. */
function bandNode(band: PriceBand, currency: string): HTMLElement {
  const node = el("div", "panel-band")
  const head = el("div", "band-head")
  const legend = el("span", "band-legend")
  legend.setAttribute("aria-hidden", "true")
  legend.append(el("span", "band-key band-key-price", "Price"))
  if (band.cost !== null)
    legend.append(el("span", "band-key band-key-cost", "Cost"))
  head.append(el("span", "", band.label), legend)

  const track = el("div", "band-track")
  track.setAttribute("aria-hidden", "true")
  const pct = (at: number) => `${(at * 100).toFixed(2)}%`
  if (band.cost !== null) {
    const from = Math.min(band.price, band.cost)
    const fill = el("span", "band-fill")
    fill.dataset.dir = band.price >= band.cost ? "up" : "down"
    fill.style.insetInlineStart = pct(from)
    fill.style.inlineSize = pct(Math.abs(band.price - band.cost))
    const cost = el("span", "band-cost")
    cost.style.insetInlineStart = pct(band.cost)
    track.append(fill, cost)
  }
  const pin = el("span", "band-pin")
  pin.style.insetInlineStart = pct(band.price)
  track.append(pin)

  const ends = el("div", "band-ends")
  ends.append(
    el("span", "", `Low ${formatPrice(band.low, currency)}`),
    el("span", "", `High ${formatPrice(band.high, currency)}`),
  )
  node.append(head, track, ends)
  return node
}

/**
 * Fill an opened row's panel: the price at the end of the range (or at
 * the scrubbed day) and its move, what the holding is, the price line
 * against the cost with its own range tabs, the facts and the year's
 * band. Returns the chart so a resize can redraw it.
 */
export function fillPanel(
  panel: HTMLElement,
  site: Site,
  row: Row,
  range: Range,
  animate: boolean,
  onRange: (range: Range) => void,
): Chart | null {
  const resolved = priceView(site, row.symbol, range)
  const facts = holdingFacts(site, row)
  if (!resolved || !facts) return null
  const { entry, start, label } = resolved
  const values = entry.closes.slice(start)

  let head = panel.querySelector<HTMLElement>(".panel-head")
  let svg = panel.querySelector<SVGSVGElement>(".panel-chart")
  let tabs = panel.querySelector<HTMLElement>(".panel-ranges")
  let key = panel.querySelector<HTMLElement>(".panel-key")
  let readout = panel.querySelector<HTMLElement>(".panel-readout")
  if (!head || !svg || !tabs || !key || !readout) {
    head = el("div", "panel-head")
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("class", "panel-chart")
    // Under the line: its range tabs, and the key to the marks on it.
    const bar = el("div", "panel-bar")
    tabs = el("div", "panel-ranges range-tabs")
    tabs.setAttribute("role", "group")
    tabs.setAttribute("aria-label", `${row.symbol} range`)
    key = el("p", "panel-key")
    bar.append(tabs, key)
    readout = el("dl", "readout panel-readout")
    panel.replaceChildren(head, svg, bar, readout)
  }

  const figure = el("div", "panel-figure")
  const price = el("span", "panel-price")
  const delta = el("span", "panel-delta")
  const when = el("span", "panel-when")
  figure.append(price, delta, when)
  // What it is: quiet tags, then the company's site.
  const about = el("ul", "panel-about")
  about.setAttribute("aria-label", "About")
  for (const fact of facts.about) about.append(el("li", "panel-tag", fact))
  if (facts.site) {
    const link = el("a", "panel-site", facts.site.host) as HTMLAnchorElement
    link.href = facts.site.href
    link.rel = "noopener"
    link.target = "_blank"
    const item = el("li")
    item.append(link)
    about.append(item)
  }
  head.replaceChildren(figure, ...(about.childElementCount ? [about] : []))

  const show = (index: number | null) => {
    const end = index ?? values.length - 1
    const at = values[end]
    const from = values.find((value) => value !== null) ?? null
    if (at === null || at === undefined || from === null) return
    price.textContent = formatPrice(at, entry.currency)
    const moved = change(values, values.indexOf(from), end) ?? 0
    delta.textContent = `${formatPriceChange(at - from, entry.currency)} · ${formatReturn(moved)}`
    delta.dataset.dir = direction(moved)
    when.textContent =
      index === null
        ? label
        : `${formatDay(site.days[start])} → ${formatDay(site.days[start + end])}`
  }
  show(null)

  syncButtons(
    tabs,
    resolved.ranges.map((key) => ({ key, label: key })),
    resolved.range,
    (key) => onRange(key as Range),
  )

  const mark =
    facts.bought !== null && facts.bought >= start ? facts.bought - start : null
  key.replaceChildren(
    ...(row.cost === null
      ? []
      : [
          el(
            "span",
            "key-cost",
            `Cost ${formatPrice(row.cost, entry.currency)}`,
          ),
        ]),
    ...(mark === null || !row.since
      ? []
      : [el("span", "key-buy", `First buy ${formatDay(row.since)}`)]),
  )

  readout.replaceChildren(
    ...facts.cards.map((card) => {
      const stat = el("div", "stat")
      const value = el("dd", "value", card.value)
      value.dataset.dir = card.value.startsWith("−") ? "down" : "up"
      stat.append(
        el("dt", "label", card.label),
        value,
        el("dd", "note", card.note),
      )
      return stat
    }),
  )
  panel.querySelector(".panel-band")?.remove()
  if (facts.band) panel.append(bandNode(facts.band, entry.currency))

  svg.setAttribute("aria-label", `${entry.symbol} price, ${label}`)
  return drawChart(svg, {
    values,
    cost: row.cost,
    mark,
    describe: (i) => {
      const value = values[i]
      return `${monthDay.format(dayInstant(site.days[start + i]))}: ${value === null ? "no price" : formatPrice(value, entry.currency)}`
    },
    dateOf: (i) => formatDay(site.days[start + i]),
    onScrub: show,
    animate,
  })
}
