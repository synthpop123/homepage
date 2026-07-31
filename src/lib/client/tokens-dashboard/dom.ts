/**
 * Shared DOM plumbing for the Tokens dashboard renderers: element
 * creation, the scoped query helper, stat-card filling, delta lines,
 * breakdown rows, the vendored brand-icon defs, and tooltip
 * positioning. Kept separate so the section renderers don't have to
 * import each other.
 */

import { formatShare } from "../tokens"

export const el = (tag: string, className: string, text?: string) => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Query helper bound to one <tokens-dashboard> root. */
export function scopedQuery(root: HTMLElement) {
  return <T extends HTMLElement = HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)
}

export type Query = ReturnType<typeof scopedQuery>

/** Fill one stat card (dt/value/sub) inside a .tk-cards list. */
export const setCard = (
  cards: HTMLElement | null,
  key: string,
  value: string,
  sub: string,
  exact?: string,
) => {
  const card = cards?.querySelector(`.tk-card[data-key="${key}"]`)
  const valueEl = card?.querySelector<HTMLElement>(".value")
  const subEl = card?.querySelector<HTMLElement>(".sub")
  if (!valueEl || !subEl) return
  valueEl.textContent = value
  if (exact) valueEl.title = exact
  subEl.textContent = sub
}

/**
 * Fill a comparison line — "↑ 34% vs yesterday". The arrow and the
 * magnitude carry the emphasis, the baseline it is measured against
 * stays muted; an empty `text` clears the line (and `.delta:empty`
 * collapses it). `title` holds the number being compared to.
 */
export const setDelta = (
  target: HTMLElement | null,
  text: string,
  title = "",
) => {
  if (!target) return
  if (!text) {
    target.replaceChildren()
    target.removeAttribute("title")
    return
  }
  const [arrow, ...rest] = text.split(" ")
  target.replaceChildren(
    el("span", "delta-val", `${arrow} ${rest.shift() ?? ""}`),
    document.createTextNode(` ${rest.join(" ")}`),
  )
  if (title) target.title = title
  else target.removeAttribute("title")
}

/** One breakdown row: brand icon, name, metric value, share. */
export type RowSpec = {
  icon: string | null
  name: string
  value: string
  /** Share of the section total (0–1, NaN when there is no total): it
   *  prints as the percentage *and* sizes the fill behind the row, so
   *  the bar always matches the number next to it. */
  share: number
  title?: string
}

export const usageRow = (icons: Icons, row: RowSpec) => {
  const item = el("li", "tk-row")
  if (row.title) item.title = row.title
  item.style.setProperty(
    "--w",
    String(Number.isFinite(row.share) ? row.share : 0),
  )
  item.append(
    icons.slot(row.icon),
    el("span", "name", row.name),
    el("span", "val", row.value),
    el("span", "share", formatShare(row.share)),
  )
  return item
}

/**
 * Clone-source lookup over the hidden SVG defs Tokens.astro renders
 * (mono brand marks plus the chevron), so runtime rows get inline SVGs
 * without shipping them twice.
 */
export function createIcons(root: HTMLElement) {
  const defs = root.querySelector(".tk-icon-defs")
  const icon = (name: string | null) => {
    const svg = name ? defs?.querySelector(`[data-icon="${name}"] svg`) : null
    return svg ? (svg.cloneNode(true) as SVGElement) : null
  }
  /** Icon slot; empty ones still reserve the column so names align. */
  const slot = (name: string | null) => {
    const wrap = el("span", "ico")
    wrap.setAttribute("aria-hidden", "true")
    const svg = icon(name)
    if (svg) wrap.append(svg)
    return wrap
  }
  return { icon, slot }
}

export type Icons = ReturnType<typeof createIcons>

/** Center a tooltip over `target`, clamped to `container`'s width. */
export function placeTip(
  tip: HTMLElement,
  target: Element,
  container: HTMLElement,
) {
  const targetRect = target.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const center = targetRect.left + targetRect.width / 2 - containerRect.left
  tip.style.left = `${Math.min(
    Math.max(center - tip.offsetWidth / 2, 0),
    containerRect.width - tip.offsetWidth,
  )}px`
}
