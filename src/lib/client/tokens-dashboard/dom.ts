/**
 * Shared DOM plumbing for the Tokens dashboard renderers: element
 * creation, the scoped query helper, stat-card filling, delta lines,
 * breakdown rows, the vendored brand-icon defs, and tooltip
 * positioning. Kept separate so the section renderers don't have to
 * import each other.
 */

import {
  aiIcon,
  type ClientModel,
  formatCostExact,
  formatExact,
  formatMetric,
  formatShare,
  type MetricKey,
  modelLabel,
  type StackPaint,
} from "../tokens"

/**
 * Color a stack segment or chip: `data-p` picks the brand hue out of the
 * palette in Tokens.astro, `data-shade` mixes it toward the background
 * so two models of the same vendor stay tellable apart. Shade 0 is the
 * pure hue and carries no attribute, which is what every non-model
 * stacking renders as.
 */
export const paint = <T extends HTMLElement>(node: T, spec?: StackPaint) => {
  node.dataset.p = spec?.p ?? "other"
  if (spec && spec.shade > 0) node.dataset.shade = String(spec.shade)
  return node
}

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

/** One breakdown row: a brand mark, name, metric value, share. */
export type RowSpec = {
  icon: string | null
  /** Renders a palette chip instead of the brand icon — for rows that
   *  have to key back to a colored bar above them. */
  chip?: string
  name: string
  value: string
  /** Share of the section total (0–1, NaN when there is no total): it
   *  prints as the percentage *and* sizes the fill behind the row, so
   *  the bar always matches the number next to it. */
  share: number
  title?: string
}

/** Fill a row's four columns into `node`, whatever element it is. */
const fillRow = <T extends HTMLElement>(
  node: T,
  icons: Icons,
  row: RowSpec,
) => {
  if (row.title) node.title = row.title
  node.style.setProperty(
    "--w",
    String(Number.isFinite(row.share) ? row.share : 0),
  )
  const lead =
    row.chip === undefined
      ? icons.slot(row.icon)
      : paint(el("span", "chip"), { p: row.chip, shade: 0 })
  node.append(
    lead,
    el("span", "name", row.name),
    el("span", "val", row.value),
    el("span", "share", formatShare(row.share)),
  )
  return node
}

export const usageRow = (icons: Icons, row: RowSpec) =>
  fillRow(el("li", "tk-row"), icons, row)

/**
 * The models a client drove, as sub-rows of that client. Ranked and
 * filtered by the metric on screen for the same reason the trend stack
 * is: in Cost, a model that is a rounding error by volume can be most
 * of the bill. Shares are of the client's own total.
 */
export const modelSubRows = (
  models: ClientModel[],
  clientTotal: number,
  metric: MetricKey,
): RowSpec[] =>
  models
    .filter((cell) => cell[metric] > 0)
    .sort((a, b) => b[metric] - a[metric])
    .map((cell) => {
      const name = modelLabel(cell.model)
      return {
        icon: aiIcon("model", cell.model),
        name,
        value: formatMetric(cell[metric], metric),
        share: clientTotal > 0 ? cell[metric] / clientTotal : Number.NaN,
        title: `${name} — ${formatExact(cell.tokens)} tokens · ${formatCostExact(
          cell.cost,
        )} · ${formatExact(cell.messages)} messages`,
      }
    })

/**
 * A row that opens onto sub-rows — a client and the models it drove.
 * The row itself becomes the button (the whole thing is the hit target,
 * which a chevron in a fifth column would not be), and the sub-rows
 * carry their share of *this* row rather than of the section, so the
 * fills read as a split of the bar directly above them.
 */
export const expandableRow = (
  icons: Icons,
  row: RowSpec,
  subRows: RowSpec[],
  open: boolean,
  onToggle: () => void,
) => {
  const item = el("li", "tk-group")
  const button = fillRow(document.createElement("button"), icons, row)
  button.type = "button"
  button.className = "tk-row tk-row-toggle"
  button.setAttribute("aria-expanded", String(open))

  // The chevron goes *inside* the name cell rather than in a column of
  // its own, so an expandable row keeps the same four-column rhythm as
  // the plain ones next to it. The label keeps its own box, which is
  // what preserves the ellipsis on a long name.
  const name = button.querySelector<HTMLElement>(".name")
  const chevron = icons.icon("chevron")
  if (name && chevron) {
    chevron.setAttribute("aria-hidden", "true")
    name.replaceChildren(el("span", "", name.textContent ?? ""), chevron)
  }

  const sub = el("ul", "tk-sub")
  sub.hidden = !open
  sub.append(...subRows.map((spec) => usageRow(icons, spec)))

  button.addEventListener("click", () => {
    const next = button.getAttribute("aria-expanded") !== "true"
    button.setAttribute("aria-expanded", String(next))
    sub.hidden = !next
    onToggle()
  })

  item.append(button, sub)
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
