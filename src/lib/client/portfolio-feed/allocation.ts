/**
 * The allocation map under the readout: the account's holdings as a
 * treemap, area by weight and each tile graded by the last session or by
 * the position's own return. Cash and the funds counted as cash
 * (`PORTFOLIO.cashLike`) form one block; the lens tab by the heading (or a
 * click on the invested block) zooms into the other — the cash-like tiles ride the zoom out of the frame, the
 * invested ones re-lay to fill it — and a breadcrumb with a minimap of the
 * whole zooms back. Hovering a tile shows its card. Every figure and
 * decision comes from `portfolio.ts`; this file only builds DOM.
 */

import { PORTFOLIO } from "@/consts"
import { el } from "@/lib/client/dom"
import {
  type AllocLayout,
  allocLabel,
  allocLayout,
  allocShares,
  allocTiles,
  type ColourBy,
  canZoom,
  formatWeight,
  type Row,
  type Site,
  type SiteCash,
  type Tile,
  tileCard,
  tileFigure,
  tileText,
} from "@/lib/client/portfolio"
import type { Rect } from "@/lib/client/treemap"
import { cashMark, logo, syncButtons } from "./render"

const SVG_NS = "http://www.w3.org/2000/svg"
/** The site's one motion: 250ms, ease-out. */
const DURATION = 250
/** A tile's corner, as `--radius-md`; small tiles take less. */
const RADIUS = 6

const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
) => {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value))
  return node
}

/** Lucide's zoom-in, for the lens tab. */
const lensIcon = () => {
  const icon = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" })
  icon.append(
    svgEl("circle", { cx: 11, cy: 11, r: 8 }),
    svgEl("path", { d: "m21 21-4.35-4.35M11 8v6M8 11h6" }),
  )
  return icon
}

type Node = {
  g: SVGGElement
  rect: SVGRectElement
  text: SVGGElement
  /** Where it is drawn now, mid-zoom included. */
  at: Rect
  tile: Tile
}

export type Allocation = {
  draw: (site: Site, rows: Row[], cash: SiteCash[]) => void
  /** Outline the tile of an opened row (null: none). */
  pin: (key: string | null) => void
  /** Outline the tile of a hovered row (null: none). */
  hover: (key: string | null) => void
}

let mounts = 0

const MODES = [
  { key: "day", label: "Day" },
  { key: "return", label: "Return" },
]

export function mountAllocation(feed: HTMLElement): Allocation | null {
  const title = feed.querySelector<HTMLElement>(".alloc-title")
  const modes = feed.querySelector<HTMLElement>(".alloc-modes")
  const map = feed.querySelector<HTMLElement>(".alloc-map")
  if (!title || !modes || !map) return null

  const hatch = `alloc-hatch-${++mounts}`
  const svg = svgEl("svg", { class: "alloc-svg", role: "img" })
  const defs = svgEl("defs")
  const pattern = svgEl("pattern", {
    id: hatch,
    width: 5,
    height: 5,
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)",
  })
  pattern.append(
    svgEl("rect", { class: "hatch-ground", width: 5, height: 5 }),
    svgEl("line", { class: "hatch-line", x1: 0, y1: 0, x2: 0, y2: 5 }),
  )
  defs.append(pattern)
  const layer = svgEl("g")
  const ring = svgEl("rect", { class: "alloc-ring", rx: RADIUS })
  svg.append(defs, layer, ring)

  const lens = el("button", "alloc-lens") as HTMLButtonElement
  lens.type = "button"
  const card = el("div", "alloc-card")
  card.hidden = true
  card.setAttribute("aria-hidden", "true")
  map.replaceChildren(svg, card)
  // Hovering the tab rings the block it zooms into.
  lens.onpointerenter = () => map.setAttribute("data-lens", "")
  lens.onpointerleave = () => map.removeAttribute("data-lens")
  lens.onfocus = () => map.setAttribute("data-lens", "")
  lens.onblur = () => map.removeAttribute("data-lens")

  const state: { by: ColourBy; zoomed: boolean } = { by: "day", zoomed: false }
  let site: Site | null = null
  let rows: Row[] = []
  let cash: SiteCash[] = []
  let tiles: Tile[] = []
  let layout: AllocLayout | null = null
  const nodes = new Map<string, Node>()
  let pinned: string | null = null
  let hovered: string | null = null
  let frame = 0
  let pointer = "mouse"

  const reduced = matchMedia("(prefers-reduced-motion: reduce)")

  const place = (node: Node, r: Rect) => {
    const width = Math.max(0, r.x1 - r.x0)
    const height = Math.max(0, r.y1 - r.y0)
    node.at = r
    node.rect.setAttribute("x", String(r.x0))
    node.rect.setAttribute("y", String(r.y0))
    node.rect.setAttribute("width", String(width))
    node.rect.setAttribute("height", String(height))
    node.rect.setAttribute(
      "rx",
      String(Math.max(0, Math.min(RADIUS, width / 3, height / 3))),
    )
  }

  /** The ticker and its figure, centred, at the largest size that fits. */
  const label = (node: Node) => {
    const { tile, at } = node
    const width = at.x1 - at.x0
    const height = at.y1 - at.y0
    const figure = tileFigure(tile, state.by)
    const fit = tileText(tile.label, figure, width, height)
    if (!fit) return node.text.replaceChildren()
    const small = fit.size - 2
    const block = fit.figure ? fit.size + 2 + small : fit.size
    const top = at.y0 + height / 2 - block / 2
    const x = at.x0 + width / 2
    const tick = svgEl("text", {
      class: "alloc-tick",
      x,
      y: top + fit.size * 0.8,
      "data-size": fit.size,
    })
    tick.textContent = tile.label
    if (!fit.figure) return node.text.replaceChildren(tick)
    const value = svgEl("text", {
      class: "alloc-figure",
      x,
      y: top + fit.size + 2 + small * 0.8,
      "data-size": small,
    })
    value.textContent = figure
    node.text.replaceChildren(tick, value)
  }

  const marks = () => {
    for (const [key, node] of nodes) {
      node.g.toggleAttribute("data-on", key === pinned)
      node.g.toggleAttribute("data-hover", key === hovered)
    }
  }

  /** The heading: the map's name, or, zoomed, the way back to it. */
  const heading = () => {
    if (!state.zoomed || !layout?.invested) {
      title.replaceChildren("Allocation", lens)
      return
    }
    const width = Math.max(1, map.clientWidth)
    const height = Math.max(1, map.clientHeight)
    const whole = allocLayout(tiles, width, height, false)
    const mini = svgEl("svg", {
      class: "alloc-mini",
      viewBox: `0 0 ${width} ${height}`,
      "aria-hidden": "true",
    })
    for (const tile of tiles) {
      const r = whole.tiles[tile.key]
      mini.append(
        svgEl("rect", {
          class: tile.cashLike ? "mini-aside" : "mini-kept",
          x: r.x0,
          y: r.y0,
          width: Math.max(0, r.x1 - r.x0),
          height: Math.max(0, r.y1 - r.y0),
          rx: 10,
        }),
      )
    }
    const r = whole.invested as Rect
    mini.append(
      svgEl("rect", {
        class: "mini-ring",
        x: r.x0 - 8,
        y: r.y0 - 8,
        width: r.x1 - r.x0 + 16,
        height: r.y1 - r.y0 + 16,
        rx: 14,
      }),
    )
    const overview = el(
      "button",
      "alloc-back alloc-back-map",
    ) as HTMLButtonElement
    overview.type = "button"
    overview.setAttribute("aria-label", "Zoom out to the whole account")
    overview.append(mini)
    const back = el("button", "alloc-back", "Allocation") as HTMLButtonElement
    back.type = "button"
    for (const button of [overview, back]) button.onclick = () => zoom(false)
    const here = el("span", "alloc-here", "Invested ")
    here.append(el("b", "", formatWeight(allocShares(tiles).invested)))
    title.replaceChildren(overview, back, el("span", "alloc-sep", "›"), here)
  }

  /** The lens tab beside the heading, and the ring it lights on the
   *  invested block. */
  const overlays = () => {
    const target = layout?.invested
    lens.hidden = state.zoomed || !target || !canZoom(tiles)
    map.toggleAttribute("data-zoomed", state.zoomed)
    if (lens.hidden || !target) return
    const share = formatWeight(allocShares(tiles).invested)
    lens.replaceChildren(lensIcon(), el("span", "", `Invested ${share}`))
    lens.setAttribute("aria-label", `Zoom in on the invested ${share}`)
    // Just inside the block: its outer edges are the frame's.
    ring.setAttribute("x", String(target.x0 + 0.75))
    ring.setAttribute("y", String(target.y0 + 0.75))
    ring.setAttribute("width", String(Math.max(0, target.x1 - target.x0 - 1.5)))
    ring.setAttribute(
      "height",
      String(Math.max(0, target.y1 - target.y0 - 1.5)),
    )
  }

  const render = (animate: boolean) => {
    if (!site) return
    tiles = allocTiles(site, rows, cash, PORTFOLIO.cashLike, state.by)
    if (!canZoom(tiles)) state.zoomed = false
    const width = Math.floor(map.clientWidth)
    const height = Math.floor(map.clientHeight)
    if (!width || !height) return
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
    svg.setAttribute("aria-label", allocLabel(tiles))
    const next = allocLayout(tiles, width, height, state.zoomed)
    layout = next

    const keys = new Set(tiles.map((tile) => tile.key))
    for (const [key, node] of nodes) {
      if (keys.has(key)) continue
      node.g.remove()
      nodes.delete(key)
    }
    for (const tile of tiles) {
      let node = nodes.get(tile.key)
      if (!node) {
        const g = svgEl("g", { class: "alloc-tile" })
        const rect = svgEl("rect")
        const text = svgEl("g")
        g.append(rect, text)
        node = { g, rect, text, at: next.tiles[tile.key], tile }
        nodes.set(tile.key, node)
        place(node, node.at)
      }
      // Kept in the tiles' order, so the paint order follows the layout.
      layer.append(node.g)
      node.tile = tile
      node.g.dataset.key = tile.key
      node.g.dataset.level = String(tile.level)
      node.g.dataset.dir = tile.dir
      node.g.toggleAttribute("data-cash", tile.cash)
      node.g.toggleAttribute("data-aside", tile.cashLike)
      node.rect.style.fill = tile.cash ? `url(#${hatch})` : ""
      node.text.replaceChildren()
    }
    marks()
    heading()
    overlays()

    cancelAnimationFrame(frame)
    const settle = () => {
      for (const node of nodes.values()) {
        place(node, next.tiles[node.tile.key])
        label(node)
      }
    }
    if (!animate || reduced.matches) return settle()
    const from = new Map([...nodes].map(([key, node]) => [key, node.at]))
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION)
      const e = 1 - (1 - t) ** 3
      if (t >= 1) return settle()
      for (const [key, node] of nodes) {
        const a = from.get(key) ?? next.tiles[key]
        const b = next.tiles[key]
        place(node, {
          x0: a.x0 + (b.x0 - a.x0) * e,
          y0: a.y0 + (b.y0 - a.y0) * e,
          x1: a.x1 + (b.x1 - a.x1) * e,
          y1: a.y1 + (b.y1 - a.y1) * e,
        })
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  /** Zoom in or out; focus follows to the control that takes the place
   *  of the one that went away. */
  const zoom = (zoomed: boolean) => {
    if (zoomed === state.zoomed || (zoomed && !canZoom(tiles))) return
    const hadFocus =
      lens.contains(document.activeElement) ||
      title.contains(document.activeElement)
    state.zoomed = zoomed
    hideCard()
    render(true)
    if (!hadFocus) return
    if (zoomed)
      title
        .querySelector<HTMLElement>(".alloc-back:not(.alloc-back-map)")
        ?.focus()
    else lens.focus()
  }
  lens.onclick = () => zoom(true)

  /** Day or Return: the measure the tiles are graded by. */
  const syncModes = () =>
    syncButtons(modes, MODES, state.by, (key) => {
      state.by = key as ColourBy
      card.dataset.key = ""
      syncModes()
      render(false)
    })
  feed.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.zoomed) zoom(false)
  })

  /* The card ------------------------------------------------------------ */

  const nodeAt = (target: EventTarget | null) => {
    const g = (target as Element | null)?.closest?.("g.alloc-tile")
    const key = (g as SVGGElement | null)?.dataset.key
    return key === undefined ? null : (nodes.get(key) ?? null)
  }

  const hideCard = () => {
    card.hidden = true
    map.removeAttribute("data-lens")
    for (const node of nodes.values()) node.g.removeAttribute("data-point")
  }

  const fillCard = (tile: Tile) => {
    if (!site || card.dataset.key === `${tile.key}:${state.by}`) return
    card.dataset.key = `${tile.key}:${state.by}`
    const info = tileCard(site, tile)
    const head = el("div", "alloc-card-head")
    const names = el("div", "alloc-card-names")
    names.append(
      el("span", "alloc-card-title", info.title),
      el("span", "alloc-card-name", info.name),
    )
    head.append(
      tile.cash
        ? cashMark(tile.label)
        : logo({ symbol: tile.label, logo: tile.logo }),
      names,
    )
    if (info.when) head.append(el("span", "alloc-card-when", info.when))
    const list = el("dl", "alloc-card-rows")
    for (const row of info.rows) {
      const value = el("dd", "", row.value)
      if (row.dir) value.dataset.dir = row.dir
      list.append(el("dt", "", row.label), value)
    }
    card.replaceChildren(head, list)
  }

  const showCard = (event: PointerEvent) => {
    const node = nodeAt(event.target)
    for (const other of nodes.values())
      other.g.toggleAttribute("data-point", other === node)
    if (!node) return hideCard()
    map.toggleAttribute(
      "data-lens",
      !state.zoomed && !node.tile.cashLike && canZoom(tiles),
    )
    fillCard(node.tile)
    card.hidden = false
    const box = map.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    const cw = card.offsetWidth
    const ch = card.offsetHeight
    let left = x + 14
    if (left + cw > box.width) left = x - cw - 14
    let top = y + 14
    if (top + ch > box.height) top = y - ch - 14
    card.style.insetInlineStart = `${Math.max(0, Math.min(left, box.width - cw))}px`
    card.style.insetBlockStart = `${Math.max(0, top)}px`
  }

  svg.onpointerdown = (event) => {
    pointer = event.pointerType
    if (event.pointerType !== "mouse") showCard(event)
  }
  svg.onpointermove = (event) => {
    if (event.pointerType === "mouse") showCard(event)
  }
  svg.onpointerleave = hideCard
  // A click on the invested block zooms; a tap only shows the card (the
  // lens tab zooms on touch).
  svg.onclick = (event) => {
    const node = nodeAt(event.target)
    if (pointer === "mouse" && node && !node.tile.cashLike) zoom(true)
  }

  return {
    draw: (nextSite, nextRows, nextCash) => {
      site = nextSite
      rows = nextRows
      cash = nextCash
      card.dataset.key = ""
      syncModes()
      render(false)
    },
    pin: (key) => {
      pinned = key
      marks()
    },
    hover: (key) => {
      hovered = key
      marks()
    },
  }
}
