/**
 * Shared DOM plumbing for the Tokens dashboard renderers: element
 * creation, the scoped query helper, stat-card filling, the vendored
 * brand-icon defs, and tooltip positioning. Kept separate so the
 * section renderers don't have to import each other.
 */

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
